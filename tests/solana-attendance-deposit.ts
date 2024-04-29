import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo,
  Account,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { SolanaAttendanceDeposit } from "../target/types/solana_attendance_deposit";
import { expect } from "chai";

describe("solana-attendance-deposit", () => {
  const provider = anchor.AnchorProvider.env();
  // Configure the client to use the local cluster.
  anchor.setProvider(provider);

  const program = anchor.workspace
    .SolanaAttendanceDeposit as Program<SolanaAttendanceDeposit>;

  const LAMPORTS_PER_SOL = 1000000000;

  const splMintAuthority = anchor.web3.Keypair.generate();

  const programAuthority = anchor.web3.Keypair.generate();
  const courseManager = anchor.web3.Keypair.generate();
  const student1 = anchor.web3.Keypair.generate();
  const student2 = anchor.web3.Keypair.generate();

  let student1UsdcAta: Account;
  let student2UsdcAta: Account;
  let usdcMint: anchor.web3.PublicKey;

  before(async () => {
    const connection = provider.connection;
    const latestBlockHash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      {
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: await connection.requestAirdrop(
          courseManager.publicKey,
          LAMPORTS_PER_SOL
        ),
      },
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      {
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: await connection.requestAirdrop(
          student1.publicKey,
          LAMPORTS_PER_SOL
        ),
      },
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      {
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: await connection.requestAirdrop(
          student2.publicKey,
          LAMPORTS_PER_SOL
        ),
      },
      "confirmed"
    );

    await provider.connection.confirmTransaction(
      {
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: await connection.requestAirdrop(
          splMintAuthority.publicKey,
          LAMPORTS_PER_SOL
        ),
      },
      "confirmed"
    );

    usdcMint = await createMint(
      provider.connection,
      splMintAuthority,
      splMintAuthority.publicKey,
      null,
      6
    );

    student1UsdcAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      splMintAuthority,
      usdcMint,
      student1.publicKey
    );

    student2UsdcAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      splMintAuthority,
      usdcMint,
      student2.publicKey
    );

    await mintTo(
      provider.connection,
      splMintAuthority,
      usdcMint,
      student1UsdcAta.address,
      splMintAuthority.publicKey,
      1000 * 10 ** 6
    );

    await mintTo(
      provider.connection,
      splMintAuthority,
      usdcMint,
      student2UsdcAta.address,
      splMintAuthority.publicKey,
      1000 * 10 ** 6
    );

    await program.methods
      .initialize()
      .accounts({
        authority: programAuthority.publicKey,
        signer: courseManager.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([courseManager, programAuthority])
      .rpc();
  });

  describe("Initialise a new course", () => {
    const courseTitle = "Learn Solana";
    let coursePda: anchor.web3.PublicKey;

    before(async () => {
      [coursePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle))],
        program.programId
      );
    });

    it("should not allow anyone other than the course manager to create courses", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      try {
        await program.methods
          .createCourse(
            courseTitle,
            new anchor.BN(250),
            new anchor.BN(timestamp + 60 * 60 * 24 * 7),
            3
          )
          .accounts({
            course: coursePda,
            manager: student1.publicKey,
            authority: programAuthority.publicKey,
            usdcMint: usdcMint,
            courseUsdc: getAssociatedTokenAddressSync(
              usdcMint,
              coursePda,
              true
            ),
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([student1])
          .rpc();

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain(
          "UnauthorizedAccess"
        );
      }
    });

    it("should initialise a new course", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      await program.methods
        .createCourse(
          courseTitle,
          new anchor.BN(250),
          new anchor.BN(timestamp + 60 * 60 * 24 * 7),
          3
        )
        .accounts({
          course: coursePda,
          manager: courseManager.publicKey,
          authority: programAuthority.publicKey,
          usdcMint: usdcMint,
          courseUsdc: getAssociatedTokenAddressSync(usdcMint, coursePda, true),
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([courseManager])
        .rpc();

      const courseData = await program.account.course.fetch(coursePda);

      expect(courseData.name).to.equal(courseTitle);
    });
  });

  describe("Student Registration", () => {
    const courseTitle = "Course Title - Registration";
    let coursePda: anchor.web3.PublicKey;

    let currentTimestamp: number;
    let lockUntilTimestamp: number;

    before(async () => {
      [coursePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle))],
        program.programId
      );

      currentTimestamp = Math.floor(Date.now() / 1000);
      lockUntilTimestamp = currentTimestamp + 60 * 60 * 24 * 7;

      await program.methods
        .createCourse(
          courseTitle,
          new anchor.BN(250 * 10 ** 6),
          new anchor.BN(lockUntilTimestamp),
          3
        )
        .accounts({
          course: coursePda,
          manager: courseManager.publicKey,
          authority: programAuthority.publicKey,
          usdcMint: usdcMint,
          courseUsdc: getAssociatedTokenAddressSync(usdcMint, coursePda, true),
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([courseManager])
        .rpc()
        .catch(console.error);
    });

    describe("When registering student1", () => {
      let student1UsdcBalanceBefore: bigint;

      before(async () => {
        student1UsdcBalanceBefore = (
          await getAccount(provider.connection, student1UsdcAta.address)
        ).amount;
        await program.methods
          .register()
          .accounts({
            course: coursePda,
            student: student1.publicKey,
            studentUsdc: getAssociatedTokenAddressSync(
              usdcMint,
              student1.publicKey
            ),
            usdcMint: usdcMint,
            courseUsdc: getAssociatedTokenAddressSync(
              usdcMint,
              coursePda,
              true
            ),
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([student1])
          .rpc()
          .catch(console.error);
      });

      it("should register student1 with the course", async () => {
        const courseData = await program.account.course.fetch(coursePda);

        expect(courseData.students[0].toBase58()).to.equal(
          student1.publicKey.toBase58()
        );
        expect(courseData.students.length).to.equal(1);
      });

      it("should receive deposit from student1", async () => {
        const student1UsdcBalanceAfter = (
          await getAccount(provider.connection, student1UsdcAta.address)
        ).amount;
        const courseUsdcBalance = (
          await getAccount(
            provider.connection,
            getAssociatedTokenAddressSync(usdcMint, coursePda, true)
          )
        ).amount;

        expect(student1UsdcBalanceBefore - student1UsdcBalanceAfter).to.equal(
          BigInt(250 * 10 ** 6)
        );
        expect(courseUsdcBalance).to.equal(BigInt(250 * 10 ** 6));
      });

      it("should not allow student1 to register again with the course", async () => {
        try {
          await program.methods
            .register()
            .accounts({
              course: coursePda,
              student: student1.publicKey,
              studentUsdc: getAssociatedTokenAddressSync(
                usdcMint,
                student1.publicKey
              ),
              usdcMint: usdcMint,
              courseUsdc: getAssociatedTokenAddressSync(
                usdcMint,
                coursePda,
                true
              ),
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([student1])
            .rpc();

          expect(true, "Transaction did not revert as expected").to.be.false;
        } catch (e: unknown) {
          expect((e as anchor.AnchorError).message).to.contain(
            "StudentAlreadyEnrolled"
          );
        }
      });
    });

    describe("When registering student2", () => {
      let student2UsdcBalanceBefore: bigint;

      before(async () => {
        student2UsdcBalanceBefore = (
          await getAccount(provider.connection, student2UsdcAta.address)
        ).amount;

        await program.methods
          .register()
          .accounts({
            course: coursePda,
            student: student2.publicKey,
            studentUsdc: getAssociatedTokenAddressSync(
              usdcMint,
              student2.publicKey
            ),
            usdcMint: usdcMint,
            courseUsdc: getAssociatedTokenAddressSync(
              usdcMint,
              coursePda,
              true
            ),
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([student2])
          .rpc()
          .catch(console.error);
      });

      it("should register student2 with the course", async () => {
        const courseData = await program.account.course.fetch(coursePda);

        expect(courseData.students[1].toBase58()).to.equal(
          student2.publicKey.toBase58()
        );
        expect(courseData.students.length).to.equal(2);
      });

      it("should receive deposit from student2", async () => {
        const student2UsdcBalanceAfter = (
          await getAccount(provider.connection, student2UsdcAta.address)
        ).amount;
        const courseUsdcBalance = (
          await getAccount(
            provider.connection,
            getAssociatedTokenAddressSync(usdcMint, coursePda, true)
          )
        ).amount;

        expect(student2UsdcBalanceBefore - student2UsdcBalanceAfter).to.equal(
          BigInt(250 * 10 ** 6)
        );
        expect(courseUsdcBalance).to.equal(BigInt(500 * 10 ** 6));
      });
    });

    describe("When registering a student with insufficient deposit", () => {
      let student3: anchor.web3.Keypair;

      before(async () => {
        student3 = anchor.web3.Keypair.generate();
        const latestBlockHash = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction(
          {
            blockhash: latestBlockHash.blockhash,
            lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
            signature: await provider.connection.requestAirdrop(
              student3.publicKey,
              LAMPORTS_PER_SOL
            ),
          },
          "confirmed"
        );
      });

      it("should fail with InsufficientUsdcDeposit", async () => {
        try {
          await program.methods
            .register()
            .accounts({
              course: coursePda,
              student: student3.publicKey,
              studentUsdc: getAssociatedTokenAddressSync(
                usdcMint,
                student3.publicKey
              ),
              usdcMint: usdcMint,
              courseUsdc: getAssociatedTokenAddressSync(
                usdcMint,
                coursePda,
                true
              ),
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([student3])
            .rpc();

          expect(true, "Transaction did not revert as expected").to.be.false;
        } catch (e: unknown) {
          expect((e as anchor.AnchorError).message).to.contain(
            "InsufficientUsdcDeposit"
          );
        }
      });
    });
  });

  describe("Create Lesson", () => {
    const courseTitle = "Course Title - Create Lesson";
    let coursePda: anchor.web3.PublicKey;

    let currentTimestamp: number;
    let lockUntilTimestamp: number;
    let attendanceDeadline: number;

    before(async () => {
      [coursePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle))],
        program.programId
      );

      currentTimestamp = Math.floor(Date.now() / 1000);
      lockUntilTimestamp = currentTimestamp + 60 * 60 * 24 * 7;
      attendanceDeadline = currentTimestamp + 60 * 10; // 10 minutes from now

      await program.methods
        .createCourse(
          courseTitle,
          new anchor.BN(250 * 10 ** 6),
          new anchor.BN(lockUntilTimestamp),
          2
        )
        .accounts({
          course: coursePda,
          manager: courseManager.publicKey,
          authority: programAuthority.publicKey,
          usdcMint: usdcMint,
          courseUsdc: getAssociatedTokenAddressSync(usdcMint, coursePda, true),
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([courseManager])
        .rpc()
        .catch(console.error);
    });

    it("should not allow non managers to create lesson", async () => {
      const courseData = await program.account.course.fetch(coursePda);
      const nextLessonId = courseData.lastLessonId + 1;
      const lessonIdBuff = Buffer.alloc(1);
      lessonIdBuff.writeUIntBE(nextLessonId, 0, 1);
      const [lesson1Pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [coursePda.toBytes(), lessonIdBuff],
        program.programId
      );

      try {
        await program.methods
          .createLesson(new anchor.BN(attendanceDeadline))
          .accounts({
            course: coursePda,
            manager: student1.publicKey,
            lesson: lesson1Pda,
            authority: programAuthority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([student1])
          .rpc();

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain(
          "UnauthorizedAccess"
        );
      }
    });

    it("should create lesson for course", async () => {
      const courseData = await program.account.course.fetch(coursePda);
      const nextLessonId = courseData.lastLessonId + 1;
      const lessonIdBuff = Buffer.alloc(1);
      lessonIdBuff.writeUIntBE(nextLessonId, 0, 1);
      const [lesson1Pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [coursePda.toBytes(), lessonIdBuff],
        program.programId
      );

      await program.methods
        .createLesson( new anchor.BN(attendanceDeadline))
        .accounts({
          course: coursePda,
          manager: courseManager.publicKey,
          lesson: lesson1Pda,
          authority: programAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([courseManager])
        .rpc();

      const lessonData = await program.account.lesson.fetch(lesson1Pda);
      expect(lessonData.attendanceDeadline.toNumber()).to.equal(
        attendanceDeadline
      );
      expect(lessonData.lessonId).to.equal(1);
      expect(lessonData.course.toBase58()).to.equal(coursePda.toBase58());
    });

    it("should fail when creating a repeated lesson ID", async () => {
      const lessonIdBuff = Buffer.alloc(1);
      lessonIdBuff.writeUIntBE(1, 0, 1);
      const [lesson1Pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [coursePda.toBytes(), lessonIdBuff],
        program.programId
      );

      try {
        await program.methods
          .createLesson( new anchor.BN(attendanceDeadline))
          .accounts({
            course: coursePda,
            manager: courseManager.publicKey,
            lesson: lesson1Pda,
            authority: programAuthority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([courseManager])
          .rpc();

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain(
          "ConstraintSeeds"
        );
      }
    });

    it("should fail with ExceededCourseLessons when create more lessons than specified", async () => {
      let courseData = await program.account.course.fetch(coursePda);
      let nextLessonId = courseData.lastLessonId + 1;
      let lessonIdBuff = Buffer.alloc(1);
      lessonIdBuff.writeUIntBE(nextLessonId, 0, 1);
      const [lesson2Pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [coursePda.toBytes(), lessonIdBuff],
        program.programId
      );

      await program.methods
        .createLesson(new anchor.BN(attendanceDeadline))
        .accounts({
          course: coursePda,
          manager: courseManager.publicKey,
          lesson: lesson2Pda,
          authority: programAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([courseManager])
        .rpc();

      courseData = await program.account.course.fetch(coursePda);
      nextLessonId = courseData.lastLessonId + 1;
      lessonIdBuff = Buffer.alloc(1);
      lessonIdBuff.writeUIntBE(nextLessonId, 0, 1);
      const [lesson3Pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [coursePda.toBytes(), lessonIdBuff],
        program.programId
      );

      try {
        await program.methods
          .createLesson( new anchor.BN(attendanceDeadline))
          .accounts({
            course: coursePda,
            manager: courseManager.publicKey,
            lesson: lesson3Pda,
            authority: programAuthority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([courseManager])
          .rpc();

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain(
          "ExceededCourseLessons"
        );
      }
    });
  });

  describe("Mark attendance", () => {
    const courseTitle = "Course Title - Mark Attendance";
    let coursePda: anchor.web3.PublicKey;

    let currentTimestamp: number;
    let lockUntilTimestamp: number;
    let attendanceDeadline: number;

    let lesson1Pda: anchor.web3.PublicKey;

    before(async () => {
      [coursePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle))],
        program.programId
      );

      currentTimestamp = Math.floor(Date.now() / 1000);
      lockUntilTimestamp = currentTimestamp + 60 * 60 * 24 * 7;
      attendanceDeadline = currentTimestamp + 60 * 10; // 10 minutes from now

      await program.methods
        .createCourse(
          courseTitle,
          new anchor.BN(250 * 10 ** 6),
          new anchor.BN(lockUntilTimestamp),
          2
        )
        .accounts({
          course: coursePda,
          manager: courseManager.publicKey,
          authority: programAuthority.publicKey,
          usdcMint: usdcMint,
          courseUsdc: getAssociatedTokenAddressSync(usdcMint, coursePda, true),
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([courseManager])
        .rpc()
        .catch(console.error);

      const courseData = await program.account.course.fetch(coursePda);
      const nextLessonId = courseData.lastLessonId + 1;
      const lesson1IdBuff = Buffer.alloc(1);
      lesson1IdBuff.writeUIntBE(nextLessonId, 0, 1);
      [lesson1Pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [coursePda.toBytes(), lesson1IdBuff],
        program.programId
      );
      await program.methods
        .createLesson(new anchor.BN(attendanceDeadline))
        .accounts({
          course: coursePda,
          manager: courseManager.publicKey,
          lesson: lesson1Pda,
          authority: programAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([courseManager])
        .rpc();

      await program.methods
        .register()
        .accounts({
          course: coursePda,
          student: student1.publicKey,
          studentUsdc: getAssociatedTokenAddressSync(
            usdcMint,
            student1.publicKey
          ),
          usdcMint: usdcMint,
          courseUsdc: getAssociatedTokenAddressSync(usdcMint, coursePda, true),
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([student1])
        .rpc();

      await program.methods
        .register()
        .accounts({
          course: coursePda,
          student: student2.publicKey,
          studentUsdc: getAssociatedTokenAddressSync(
            usdcMint,
            student2.publicKey
          ),
          usdcMint: usdcMint,
          courseUsdc: getAssociatedTokenAddressSync(usdcMint, coursePda, true),
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([student2])
        .rpc();
    });

    it("should allow student1 mark attendance", async () => {
      const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
          student1.publicKey.toBytes(),
        ],
        program.programId
      );

      await program.methods
        .markAttendance(1)
        .accounts({
          course: coursePda,
          lesson: lesson1Pda,
          student: student1.publicKey,
          attendance: attendancePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([student1])
        .rpc();

      const attendanceData = await program.account.attendance.fetch(
        attendancePda
      );

      expect(attendanceData.course.toBase58()).to.equal(coursePda.toBase58());
      expect(attendanceData.student.toBase58()).to.equal(
        student1.publicKey.toBase58()
      );
      expect(attendanceData.attendance[0]).to.equal(1);
    });

    it("should fail with AttendanceAlreadyMarked when attendance is already marked", async () => {
      const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
          student1.publicKey.toBytes(),
        ],
        program.programId
      );

      try {
        await program.methods
          .markAttendance(1)
          .accounts({
            course: coursePda,
            lesson: lesson1Pda,
            student: student1.publicKey,
            attendance: attendancePda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([student1])
          .rpc();

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain(
          "AttendanceAlreadyMarked"
        );
      }
    });

    it("should allow student2 mark attendance", async () => {
      const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
          student2.publicKey.toBytes(),
        ],
        program.programId
      );

      await program.methods
        .markAttendance(1)
        .accounts({
          course: coursePda,
          lesson: lesson1Pda,
          student: student2.publicKey,
          attendance: attendancePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([student2])
        .rpc();

      const attendanceData = await program.account.attendance.fetch(
        attendancePda
      );

      expect(attendanceData.course.toBase58()).to.equal(coursePda.toBase58());
      expect(attendanceData.student.toBase58()).to.equal(
        student2.publicKey.toBase58()
      );
      expect(attendanceData.attendance[0]).to.equal(1);
    });

    it("should fail when non-student mark attendance", async () => {
      const student3 = anchor.web3.Keypair.generate();
      const latestBlockHash = await provider.connection.getLatestBlockhash();
      await provider.connection.confirmTransaction(
        {
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: await provider.connection.requestAirdrop(
            student3.publicKey,
            LAMPORTS_PER_SOL
          ),
        },
        "confirmed"
      );

      const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
          student3.publicKey.toBytes(),
        ],
        program.programId
      );

      try {
        await program.methods
          .markAttendance(1)
          .accounts({
            course: coursePda,
            lesson: lesson1Pda,
            student: student3.publicKey,
            attendance: attendancePda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([student3])
          .rpc();

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain(
          "StudentNotEnrolled."
        );
      }
    });
  });
});

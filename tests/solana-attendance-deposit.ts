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

  let currentTimestamp: number;

  before(async () => {
    currentTimestamp = Math.floor(Date.now() / 1000);

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

    let lockUntilTimestamp: number;
    let attendanceDeadline: number;

    before(async () => {
      [coursePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle))],
        program.programId
      );

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
      let courseData = await program.account.course.fetch(coursePda);
      const nextLessonId = courseData.lastLessonId + 1;
      const lessonIdBuff = Buffer.alloc(1);
      lessonIdBuff.writeUIntBE(nextLessonId, 0, 1);
      const [lesson1Pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [coursePda.toBytes(), lessonIdBuff],
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

      const lessonData = await program.account.lesson.fetch(lesson1Pda);
      courseData = await program.account.course.fetch(coursePda);

      expect(lessonData.attendanceDeadline.toNumber()).to.equal(
        attendanceDeadline
      );
      expect(lessonData.lessonId).to.equal(1);
      expect(lessonData.course.toBase58()).to.equal(coursePda.toBase58());
      expect(courseData.lastLessonId).to.equal(nextLessonId);
    });

    it("should not allow student registration after the first lesson is created", async () => {
      try {
        await registerCourse({
          program,
          usdcMint,
          student: student1,
          courseTitle,
        });

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain("ConstraintRaw");
      }
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

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain("ConstraintSeeds");
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
          .createLesson(new anchor.BN(attendanceDeadline))
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

    before(async () => {
      [coursePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle))],
        program.programId
      );

      currentTimestamp = Math.floor(Date.now() / 1000);
      lockUntilTimestamp = currentTimestamp + 60 * 60 * 24 * 7;
      attendanceDeadline = currentTimestamp + 60 * 10; // 10 minutes from now

      // Create course
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

      // Register Student1 for the course
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

      // Register Student2 for the course
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

    it("should fail when marking attendance for a non-existing lesson", async () => {
      const lessonId = 1; //Not created yet

      const lesson1IdBuff = Buffer.alloc(1);
      lesson1IdBuff.writeUIntBE(lessonId, 0, 1);
      const [lesson1Pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [coursePda.toBytes(), lesson1IdBuff],
        program.programId
      );

      const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
          student1.publicKey.toBytes(),
        ],
        program.programId
      );

      try {
        await program.methods
          .markAttendance(lessonId)
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
          "AccountNotInitialized."
        );
      }
    });

    describe("Lesson 1", () => {
      const lessonId = 1;
      let lesson1Pda: anchor.web3.PublicKey;

      before(async () => {
        // Create Lesson1 for the course
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
          .markAttendance(lessonId)
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
        expect(attendanceData.attendance[0]).to.equal(lessonId);
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
            .markAttendance(lessonId)
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
          .markAttendance(lessonId)
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
        expect(attendanceData.attendance[0]).to.equal(lessonId);
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
            .markAttendance(lessonId)
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

    describe("Lesson 2", () => {
      const lessonId = 2;
      let lesson2Pda: anchor.web3.PublicKey;

      before(async () => {
        // Create Lesson2 for the course
        const courseData = await program.account.course.fetch(coursePda);
        const nextLessonId = courseData.lastLessonId + 1;
        const lesson2IdBuff = Buffer.alloc(1);
        lesson2IdBuff.writeUIntBE(nextLessonId, 0, 1);
        [lesson2Pda] = anchor.web3.PublicKey.findProgramAddressSync(
          [coursePda.toBytes(), lesson2IdBuff],
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
          .markAttendance(lessonId)
          .accounts({
            course: coursePda,
            lesson: lesson2Pda,
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
        expect(attendanceData.attendance[1]).to.equal(lessonId);
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
          .markAttendance(lessonId)
          .accounts({
            course: coursePda,
            lesson: lesson2Pda,
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
        expect(attendanceData.attendance[1]).to.equal(lessonId);
      });
    });

    describe("Late attendance marking", () => {
      let lesson3Pda: anchor.web3.PublicKey;
      let attendanceDeadline: number;
      let nextLessonId: number;

      before(async () => {
        attendanceDeadline = currentTimestamp + 1; // 1 seconds from now for testing purposes

        // Create Lesson3 for the course
        const courseData = await program.account.course.fetch(coursePda);
        nextLessonId = courseData.lastLessonId + 1;
        const lesson3IdBuff = Buffer.alloc(1);
        lesson3IdBuff.writeUIntBE(nextLessonId, 0, 1);
        [lesson3Pda] = anchor.web3.PublicKey.findProgramAddressSync(
          [coursePda.toBytes(), lesson3IdBuff],
          program.programId
        );
        await program.methods
          .createLesson(new anchor.BN(attendanceDeadline))
          .accounts({
            course: coursePda,
            manager: courseManager.publicKey,
            lesson: lesson3Pda,
            authority: programAuthority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([courseManager])
          .rpc();
      });

      it("should fail with LateForLesson after attendance deadline", async () => {
        const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
            student1.publicKey.toBytes(),
          ],
          program.programId
        );

        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          await program.methods
            .markAttendance(nextLessonId)
            .accounts({
              course: coursePda,
              lesson: lesson3Pda,
              student: student1.publicKey,
              attendance: attendancePda,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([student1])
            .rpc();

          expect(true, "Transaction did not revert as expected").to.be.false;
        } catch (e: unknown) {
          expect((e as anchor.AnchorError).message).to.contain("LateForLesson");
        }
      });
    });
  });

  describe("Withdraw Deposit", () => {
    const courseTitle = "Course Title - Withdraw Deposit";

    let lockUntilTimestamp: number;
    let attendanceDeadline: number;

    before(async () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      lockUntilTimestamp = currentTimestamp + 5; // 5 seconds from now for testing purpose
      attendanceDeadline = currentTimestamp + 3; // 3 seconds from now for testing purpose

      await createCourse(
        courseTitle,
        new anchor.BN(250 * 10 ** 6),
        lockUntilTimestamp,
        3,
        {
          program,
          courseManager,
          programAuthority,
          usdcMint,
        }
      );

      await registerCourse({
        program,
        usdcMint,
        student: student1,
        courseTitle,
      });
    });

    describe("When not all lessons have started", () => {
      before(async () => {
        const lessonId = 1;

        await createLesson(new anchor.BN(attendanceDeadline), {
          program,
          courseManager,
          programAuthority,
          lessonId,
          courseTitle,
        });

        await markAttendance(lessonId, {
          program,
          student: student1,
          courseTitle,
        });
      });

      it("should not allow withdrawal of deposit", async () => {
        try {
          await withdrawDeposit({
            program,
            student: student1,
            courseTitle,
            usdcMint,
          });

          expect(true, "Transaction did not revert as expected").to.be.false;
        } catch (e: unknown) {
          expect((e as anchor.AnchorError).message).to.contain("ConstraintRaw");
        }
      });
    });

    describe("When all lessons have started but not all attendances are marked", () => {
      before(async () => {
        await createLesson(new anchor.BN(attendanceDeadline), {
          program,
          courseManager,
          programAuthority,
          lessonId: 2,
          courseTitle,
        });

        await createLesson(new anchor.BN(attendanceDeadline), {
          program,
          courseManager,
          programAuthority,
          lessonId: 3,
          courseTitle,
        });
      });

      it("should not allow withdrawal of deposit", async () => {
        try {
          await withdrawDeposit({
            program,
            student: student1,
            courseTitle,
            usdcMint,
          });

          expect(true, "Transaction did not revert as expected").to.be.false;
        } catch (e: unknown) {
          expect((e as anchor.AnchorError).message).to.contain("ConstraintRaw");
        }
      });
    });

    describe("When all attendances are marked", () => {
      before(async () => {
        // Mark attendance for lesson 2
        await markAttendance(2, {
          program,
          student: student1,
          courseTitle,
        }).catch(console.error);

        // Mark attendance for lesson 3
        await markAttendance(3, {
          program,
          student: student1,
          courseTitle,
        }).catch(console.error);
      });

      it("should fail withdrawal if a non-enrolled student withdraws for an enrolled student", async () => {
        try {
          await withdrawDeposit({
            program,
            student: student2,
            courseTitle,
            usdcMint,
          });

          expect(true, "Transaction did not revert as expected").to.be.false;
        } catch (e: unknown) {
          expect((e as anchor.AnchorError).message).to.contain(
            "AccountNotInitialized."
          );
        }
      });

      it("should fail withdrawal with NotReadyForWithdrawal if still within locking period", async () => {
        try {
          await withdrawDeposit({
            program,
            student: student1,
            courseTitle,
            usdcMint,
          });

          expect(true, "Transaction did not revert as expected").to.be.false;
        } catch (e: unknown) {
          expect((e as anchor.AnchorError).message).to.contain(
            "NotReadyForWithdrawal"
          );
        }
      });

      it("should withdraw deposit successfully after locking period", async () => {
        await new Promise((resolve) => setTimeout(resolve, 4000));

        const student1UsdcBalanceBefore = (
          await getAccount(provider.connection, student1UsdcAta.address)
        ).amount;

        const [coursePda] = getCoursePda(program, courseTitle);
        const courseUsdcBalanceBefore = (
          await getAccount(
            provider.connection,
            getAssociatedTokenAddressSync(usdcMint, coursePda, true)
          )
        ).amount;

        await withdrawDeposit({
          program,
          student: student1,
          courseTitle,
          usdcMint,
        }).catch(console.error);

        const student1UsdcBalanceAfter = (
          await getAccount(provider.connection, student1UsdcAta.address)
        ).amount;
        const courseUsdcBalanceAfter = (
          await getAccount(
            provider.connection,
            getAssociatedTokenAddressSync(usdcMint, coursePda, true)
          )
        ).amount;

        expect(
          student1UsdcBalanceAfter - student1UsdcBalanceBefore,
          "Student USDC"
        ).to.equal(BigInt(250 * 10 ** 6));
        expect(
          courseUsdcBalanceBefore - courseUsdcBalanceAfter,
          "Course USDC"
        ).to.equal(BigInt(250 * 10 ** 6));
      });
    });
  });
});

const createLesson = async (
  attendanceDeadline: anchor.BN,
  {
    program,
    courseManager,
    programAuthority,
    lessonId,
    courseTitle,
  }: {
    program: anchor.Program<SolanaAttendanceDeposit>;
    courseManager: anchor.web3.Keypair;
    programAuthority: anchor.web3.Keypair;
    lessonId: number;
    courseTitle: string;
  }
) => {
  const [coursePda] = getCoursePda(program, courseTitle);
  const lessonIdBuff = Buffer.alloc(1);
  lessonIdBuff.writeUIntBE(lessonId, 0, 1);
  const [lessonPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [coursePda.toBytes(), lessonIdBuff],
    program.programId
  );

  return await program.methods
    .createLesson(attendanceDeadline)
    .accounts({
      course: coursePda,
      manager: courseManager.publicKey,
      lesson: lessonPda,
      authority: programAuthority.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([courseManager])
    .rpc();
};

const markAttendance = async (
  lessonId: number,
  {
    program,
    student,
    courseTitle,
  }: {
    program: anchor.Program<SolanaAttendanceDeposit>;
    student: anchor.web3.Keypair;
    courseTitle: string;
  }
) => {
  const [coursePda] = getCoursePda(program, courseTitle);
  const lessonIdBuff = Buffer.alloc(1);
  lessonIdBuff.writeUIntBE(lessonId, 0, 1);
  const [lessonPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [coursePda.toBytes(), lessonIdBuff],
    program.programId
  );
  const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
      student.publicKey.toBytes(),
    ],
    program.programId
  );

  return await program.methods
    .markAttendance(lessonId)
    .accounts({
      course: coursePda,
      lesson: lessonPda,
      student: student.publicKey,
      attendance: attendancePda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([student])
    .rpc();
};

const registerCourse = async ({
  program,
  usdcMint,
  student,
  courseTitle,
}: {
  program: anchor.Program<SolanaAttendanceDeposit>;
  usdcMint: anchor.web3.PublicKey;
  student: anchor.web3.Keypair;
  courseTitle: string;
}) => {
  const [coursePda] = getCoursePda(program, courseTitle);
  return await program.methods
    .register()
    .accounts({
      course: coursePda,
      student: student.publicKey,
      studentUsdc: getAssociatedTokenAddressSync(usdcMint, student.publicKey),
      usdcMint: usdcMint,
      courseUsdc: getAssociatedTokenAddressSync(usdcMint, coursePda, true),
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([student])
    .rpc();
};

const createCourse = async (
  courseTitle: string,
  depositAmount: anchor.BN,
  lockUntilTimestamp: number,
  numOfLessons: number,
  {
    program,
    courseManager,
    programAuthority,
    usdcMint,
  }: {
    program: anchor.Program<SolanaAttendanceDeposit>;
    courseManager: anchor.web3.Keypair;
    programAuthority: anchor.web3.Keypair;
    usdcMint: anchor.web3.PublicKey;
  }
) => {
  const [coursePda] = getCoursePda(program, courseTitle);
  return await program.methods
    .createCourse(
      courseTitle,
      depositAmount,
      new anchor.BN(lockUntilTimestamp),
      numOfLessons
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
};

const withdrawDeposit = async ({
  program,
  student,
  usdcMint,
  courseTitle,
}: {
  program: anchor.Program<SolanaAttendanceDeposit>;
  student: anchor.web3.Keypair;
  usdcMint: anchor.web3.PublicKey;
  courseTitle: string;
}) => {
  const [coursePda, coursePdaBump] = getCoursePda(program, courseTitle);
  const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
      student.publicKey.toBytes(),
    ],
    program.programId
  );
  return await program.methods
    .withdraw(coursePdaBump)
    .accounts({
      course: coursePda,
      student: student.publicKey,
      studentUsdc: getAssociatedTokenAddressSync(usdcMint, student.publicKey),
      courseUsdc: getAssociatedTokenAddressSync(usdcMint, coursePda, true),
      usdcMint: usdcMint,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      attendance: attendancePda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([student])
    .rpc();
};

const getCoursePda = (
  program: anchor.Program<SolanaAttendanceDeposit>,
  courseTitle: string
) =>
  anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle))],
    program.programId
  );

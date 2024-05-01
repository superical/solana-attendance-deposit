import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo,
  Account,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { SolanaAttendanceDeposit } from "../target/types/solana_attendance_deposit";
import { expect } from "chai";
import { it } from "mocha";
import {
  createCourse,
  createLesson,
  getCoursePda,
  markAttendance,
  registerCourse,
  withdrawDeposit,
} from "./utils";

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
        await createCourse(
          courseTitle,
          new anchor.BN(250 * 10 ** 6),
          timestamp + 60 * 60 * 24 * 7,
          3,
          {
            program,
            courseManager: student1,
            programAuthority,
            depositTokenMint: usdcMint,
          }
        );

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain(
          "UnauthorizedAccess"
        );
      }
    });

    it("should initialise a new course", async () => {
      const timestamp = Math.floor(Date.now() / 1000);

      await createCourse(
        courseTitle,
        new anchor.BN(250 * 10 ** 6),
        timestamp + 60 * 60 * 24 * 7,
        3,
        {
          program,
          courseManager,
          programAuthority,
          depositTokenMint: usdcMint,
        }
      );

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

      await createCourse(
        courseTitle,
        new anchor.BN(250 * 10 ** 6),
        lockUntilTimestamp,
        3,
        {
          program,
          courseManager,
          programAuthority,
          depositTokenMint: usdcMint,
        }
      );
    });

    describe("When registering student1", () => {
      let student1UsdcBalanceBefore: bigint;

      before(async () => {
        student1UsdcBalanceBefore = (
          await getAccount(provider.connection, student1UsdcAta.address)
        ).amount;

        await registerCourse({
          program,
          depositTokenMint: usdcMint,
          student: student1,
          courseTitle,
        });
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
          await registerCourse({
            program,
            depositTokenMint: usdcMint,
            student: student1,
            courseTitle,
          });

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

        await registerCourse({
          program,
          depositTokenMint: usdcMint,
          student: student2,
          courseTitle,
        });
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
          await registerCourse({
            program,
            depositTokenMint: usdcMint,
            student: student3,
            courseTitle,
          });

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

      await createCourse(
        courseTitle,
        new anchor.BN(250 * 10 ** 6),
        lockUntilTimestamp,
        2,
        {
          program,
          courseManager,
          programAuthority,
          depositTokenMint: usdcMint,
        }
      );
    });

    it("should not allow non managers to create lesson", async () => {
      const courseData = await program.account.course.fetch(coursePda);
      const nextLessonId = courseData.lastLessonId + 1;

      try {
        await createLesson(new anchor.BN(attendanceDeadline), {
          program,
          courseManager: student1,
          programAuthority,
          lessonId: nextLessonId,
          courseTitle,
        });

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

      await createLesson(new anchor.BN(attendanceDeadline), {
        program,
        courseManager,
        programAuthority,
        lessonId: nextLessonId,
        courseTitle,
      });

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
          depositTokenMint: usdcMint,
          student: student1,
          courseTitle,
        });

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain("ConstraintRaw");
      }
    });

    it("should fail when creating a repeated lesson ID", async () => {
      try {
        await createLesson(new anchor.BN(attendanceDeadline), {
          program,
          courseManager,
          programAuthority,
          lessonId: 1,
          courseTitle,
        });

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain("ConstraintSeeds");
      }
    });

    it("should fail with ExceededCourseLessons when create more lessons than specified", async () => {
      let courseData = await program.account.course.fetch(coursePda);
      let nextLessonId = courseData.lastLessonId + 1;
      await createLesson(new anchor.BN(attendanceDeadline), {
        program,
        courseManager,
        programAuthority,
        lessonId: nextLessonId,
        courseTitle,
      });

      courseData = await program.account.course.fetch(coursePda);
      nextLessonId = courseData.lastLessonId + 1;
      try {
        await createLesson(new anchor.BN(attendanceDeadline), {
          program,
          courseManager,
          programAuthority,
          lessonId: nextLessonId,
          courseTitle,
        });

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
      await createCourse(
        courseTitle,
        new anchor.BN(250 * 10 ** 6),
        lockUntilTimestamp,
        3,
        {
          program,
          courseManager,
          programAuthority,
          depositTokenMint: usdcMint,
        }
      );

      // Register Student1 for the course
      await registerCourse({
        program,
        depositTokenMint: usdcMint,
        student: student1,
        courseTitle,
      });

      // Register Student2 for the course
      await registerCourse({
        program,
        depositTokenMint: usdcMint,
        student: student2,
        courseTitle,
      });
    });

    it("should fail when marking attendance for a non-existing lesson", async () => {
      const lessonId = 1; //Not created yet

      try {
        await markAttendance(lessonId, {
          program,
          student: student1,
          courseTitle,
        });

        expect(true, "Transaction did not revert as expected").to.be.false;
      } catch (e: unknown) {
        expect((e as anchor.AnchorError).message).to.contain(
          "AccountNotInitialized."
        );
      }
    });

    describe("Lesson 1", () => {
      const lessonId = 1;

      before(async () => {
        // Create Lesson1 for the course
        await createLesson(new anchor.BN(attendanceDeadline), {
          program,
          courseManager,
          programAuthority,
          courseTitle,
          lessonId,
        });
      });

      it("should allow student1 mark attendance", async () => {
        const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
            student1.publicKey.toBytes(),
          ],
          program.programId
        );

        await markAttendance(lessonId, {
          program,
          student: student1,
          courseTitle,
        });

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
        try {
          await markAttendance(lessonId, {
            program,
            student: student1,
            courseTitle,
          });

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

        await markAttendance(lessonId, {
          program,
          student: student2,
          courseTitle,
        });

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

        try {
          await markAttendance(lessonId, {
            program,
            student: student3,
            courseTitle,
          });

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

      before(async () => {
        // Create Lesson2 for the course
        await createLesson(new anchor.BN(attendanceDeadline), {
          program,
          courseManager,
          programAuthority,
          courseTitle,
          lessonId,
        });
      });

      it("should allow student1 mark attendance", async () => {
        const [attendancePda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle)),
            student1.publicKey.toBytes(),
          ],
          program.programId
        );

        await markAttendance(lessonId, {
          program,
          student: student1,
          courseTitle,
        });

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

        await markAttendance(lessonId, {
          program,
          student: student2,
          courseTitle,
        });

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
      let attendanceDeadline: number;
      let nextLessonId: number;

      before(async () => {
        attendanceDeadline = currentTimestamp + 1; // 1 seconds from now for testing purposes

        // Create Lesson3 for the course
        const courseData = await program.account.course.fetch(coursePda);
        nextLessonId = courseData.lastLessonId + 1;

        await createLesson(new anchor.BN(attendanceDeadline), {
          program,
          courseManager,
          programAuthority,
          courseTitle,
          lessonId: nextLessonId,
        });
      });

      it("should fail with LateForLesson after attendance deadline", async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          await markAttendance(nextLessonId, {
            program,
            student: student1,
            courseTitle,
          });

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
      lockUntilTimestamp = currentTimestamp + 7; // 7 seconds from now for testing purpose
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
          depositTokenMint: usdcMint,
        }
      );

      await registerCourse({
        program,
        depositTokenMint: usdcMint,
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
            depositTokenMint: usdcMint,
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
            depositTokenMint: usdcMint,
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
            depositTokenMint: usdcMint,
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
            depositTokenMint: usdcMint,
          });

          expect(true, "Transaction did not revert as expected").to.be.false;
        } catch (e: unknown) {
          expect((e as anchor.AnchorError).message).to.contain(
            "NotReadyForWithdrawal"
          );
        }
      });

      it("should withdraw deposit successfully after locking period", async () => {
        await new Promise((resolve) => setTimeout(resolve, 7000));

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
          depositTokenMint: usdcMint,
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

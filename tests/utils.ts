import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SolanaAttendanceDeposit } from "../target/types/solana_attendance_deposit";

export const createLesson = async (
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
    programAuthority: anchor.web3.PublicKey;
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
      authority: programAuthority,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([courseManager])
    .rpc();
};

export const markAttendance = async (
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

export const registerCourse = async ({
  program,
  depositTokenMint,
  student,
  courseTitle,
}: {
  program: anchor.Program<SolanaAttendanceDeposit>;
  depositTokenMint: anchor.web3.PublicKey;
  student: anchor.web3.Keypair;
  courseTitle: string;
}) => {
  const [coursePda] = getCoursePda(program, courseTitle);
  return await program.methods
    .register()
    .accounts({
      course: coursePda,
      student: student.publicKey,
      studentDepositToken: getAssociatedTokenAddressSync(
        depositTokenMint,
        student.publicKey
      ),
      depositTokenMint,
      courseDepositToken: getAssociatedTokenAddressSync(
        depositTokenMint,
        coursePda,
        true
      ),
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([student])
    .rpc();
};

export const createCourse = async (
  courseTitle: string,
  depositAmount: anchor.BN,
  lockUntilTimestamp: number,
  numOfLessons: number,
  {
    program,
    courseManager,
    programAuthority,
    depositTokenMint,
  }: {
    program: anchor.Program<SolanaAttendanceDeposit>;
    courseManager: anchor.web3.Keypair;
    programAuthority: anchor.web3.PublicKey;
    depositTokenMint: anchor.web3.PublicKey;
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
      authority: programAuthority,
      depositTokenMint,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([courseManager])
    .rpc();
};

export const withdrawDeposit = async ({
  program,
  student,
  depositTokenMint,
  courseTitle,
}: {
  program: anchor.Program<SolanaAttendanceDeposit>;
  student: anchor.web3.Keypair;
  depositTokenMint: anchor.web3.PublicKey;
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
      studentDepositToken: getAssociatedTokenAddressSync(
        depositTokenMint,
        student.publicKey
      ),
      courseDepositToken: getAssociatedTokenAddressSync(
        depositTokenMint,
        coursePda,
        true
      ),
      depositTokenMint,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      attendance: attendancePda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([student])
    .rpc();
};

export const getCoursePda = (
  program: anchor.Program<SolanaAttendanceDeposit>,
  courseTitle: string
) =>
  anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(courseTitle))],
    program.programId
  );

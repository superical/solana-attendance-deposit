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
  });

  describe("Initialise a new course", () => {
    const courseTitle = "Learn Solana";
    let coursePda: anchor.web3.PublicKey;

    before(async () => {
      await program.methods
        .initialize()
        .accounts({
          authority: programAuthority.publicKey,
          signer: courseManager.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([courseManager, programAuthority])
        .rpc();

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
            new anchor.BN(timestamp + 60 * 60 * 24 * 7)
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
          new anchor.BN(timestamp + 60 * 60 * 24 * 7)
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
          new anchor.BN(lockUntilTimestamp)
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
});

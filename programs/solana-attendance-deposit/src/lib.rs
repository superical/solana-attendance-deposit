use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, TokenAccount, Token, Transfer, Mint};

declare_id!("G8PAMHAVZVAzcsKAXVtuJ69msx9tB1tNYKRPoSCtZ54G");

#[program]
pub mod solana_attendance_deposit {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let course_manager = &mut ctx.accounts.authority;
        course_manager.manager = ctx.accounts.signer.key();

        Ok(())
    }

    pub fn create_course(ctx: Context<NewCourse>, name: String, deposit: u64, lock_until: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.manager.key(), ctx.accounts.authority.manager.key(), ErrorCode::UnauthorizedAccess);

        let course = &mut ctx.accounts.course;
        course.new(name, ctx.accounts.manager.key(), deposit, lock_until)
    }

    pub fn register(ctx: Context<Registration>) -> Result<()> {
        let course = &mut ctx.accounts.course;
        let student = &ctx.accounts.student;

        let student_balance = ctx.accounts.student_usdc.amount;
        if student_balance < course.deposit {
            return Err(ErrorCode::InsufficientUsdcDeposit.into());
        }

        let cpi_accounts = Transfer {
            from: ctx.accounts.student_usdc.to_account_info(),
            to: ctx.accounts.course_usdc.to_account_info(),
            authority: ctx.accounts.student.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, course.deposit)?;

        course.register(student.key())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = 8 + 32)]
    pub authority: Account<'info, CourseManager>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String, deposit: u64, lock_until: u64)]
pub struct NewCourse<'info> {
    #[account(
    init,
    payer = manager,
    space = 8 + std::mem::size_of::< Course > (),
    seeds = [name.as_bytes()],
    bump,
    )]
    pub course: Account<'info, Course>,
    #[account(mut)]
    pub manager: Signer<'info>,
    pub authority: Account<'info, CourseManager>,
    #[account(
    init_if_needed,
    payer = manager,
    associated_token::mint = usdc_mint,
    associated_token::authority = course,
    )]
    pub course_usdc: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Registration<'info> {
    #[account(
    mut,
    seeds = [course.name.as_bytes()],
    bump,
    realloc = course.to_account_info().data_len() + std::mem::size_of::< Pubkey > (),
    realloc::payer = student,
    realloc::zero = false,
    )]
    pub course: Account<'info, Course>,
    #[account(mut)]
    pub student: Signer<'info>,
    #[account(
    init_if_needed,
    payer = student,
    associated_token::mint = usdc_mint,
    associated_token::authority = student,
    )]
    pub student_usdc: Account<'info, TokenAccount>,
    #[account(
    init_if_needed,
    payer = student,
    associated_token::mint = usdc_mint,
    associated_token::authority = course,
    )]
    pub course_usdc: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Course {
    pub name: String,
    pub manager: Pubkey,
    pub students: Vec<Pubkey>,
    pub deposit: u64,
    pub lock_until: u64,
}

#[account]
pub struct CourseManager {
    pub manager: Pubkey,
}

impl Course {
    pub const MAXIMUM_SIZE: usize = 32 + 32 + 32 + 8 + 8;

    pub fn new(&mut self, name: String, manager: Pubkey, deposit: u64, lock_until: u64) -> Result<()> {
        self.name = name;
        self.manager = manager;
        self.deposit = deposit;
        self.lock_until = lock_until;

        Ok(())
    }

    pub fn register(&mut self, student: Pubkey) -> Result<()> {
        if self.students.contains(&student) {
            return Err(ErrorCode::StudentAlreadyEnrolled.into());
        }

        self.students.push(student.key());

        Ok(())
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Student is not enrolled in the course")]
    StudentNotEnrolled,
    #[msg("Student already enrolled in the course")]
    StudentAlreadyEnrolled,
    #[msg("Insufficient USDCC balance for deposit")]
    InsufficientUsdcDeposit,
    #[msg("Unauthorised access")]
    UnauthorizedAccess,
}

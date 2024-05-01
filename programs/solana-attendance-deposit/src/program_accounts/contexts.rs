use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::program_accounts::structs::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
    init,
    payer = signer,
    space = 8 + 32,
    seeds = [b"authority"],
    bump,
    )]
    pub authority: Account<'info, CourseManager>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String)]
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
    pub deposit_token_mint: Account<'info, Mint>,
    #[account(
    seeds = [b"authority"],
    bump,
    )]
    pub authority: Account<'info, CourseManager>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Registration<'info> {
    #[account(
    mut,
    seeds = [course.name.as_bytes()],
    bump,
    constraint = course.last_lesson_id == 0,
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
    associated_token::mint = deposit_token_mint,
    associated_token::authority = student,
    constraint = deposit_token_mint.key() == course.deposit_token,
    )]
    pub student_deposit_token: Account<'info, TokenAccount>,
    #[account(
    init_if_needed,
    payer = student,
    associated_token::mint = deposit_token_mint,
    constraint = deposit_token_mint.key() == course.deposit_token,
    associated_token::authority = course,
    )]
    pub course_deposit_token: Account<'info, TokenAccount>,
    pub deposit_token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(attendance_deadline: u64)]
pub struct CreateLesson<'info> {
    #[account(
    init,
    payer = manager,
    space = 8 + std::mem::size_of::< Lesson > (),
    seeds = [course.key().as_ref(), & (course.last_lesson_id + 1).to_be_bytes()],
    bump,
    )]
    pub lesson: Account<'info, Lesson>,
    #[account(mut)]
    pub course: Account<'info, Course>,
    #[account(mut)]
    pub manager: Signer<'info>,
    #[account(
    seeds = [b"authority"],
    bump,
    )]
    pub authority: Account<'info, CourseManager>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MarkAttendance<'info> {
    #[account(
    mut,
    seeds = [course.name.as_bytes()],
    bump,
    )]
    pub course: Account<'info, Course>,
    #[account(
    init_if_needed,
    payer = student,
    space = 8 + std::mem::size_of::< Attendance > () + course.num_of_lessons as usize,
    constraint = course.key() == lesson.course,
    seeds = [course.name.as_bytes(), student.key().as_ref()],
    bump,
    )]
    pub attendance: Account<'info, Attendance>,
    pub lesson: Account<'info, Lesson>,
    #[account(mut)]
    pub student: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdrawal<'info> {
    #[account(
    mut,
    seeds = [course.name.as_bytes()],
    bump,
    )]
    pub course: Account<'info, Course>,
    #[account(
    mut,
    constraint = ! attendance.withdrawn,
    )]
    pub attendance: Account<'info, Attendance>,
    #[account(mut)]
    pub student: Signer<'info>,
    #[account(mut)]
    pub student_deposit_token: Account<'info, TokenAccount>,
    #[account(
    mut,
    constraint = course.key() == attendance.course &&
    student.key() == attendance.student &&
    attendance.attendance.len() == course.num_of_lessons as usize &&
    ! attendance.withdrawn &&
    deposit_token_mint.key() == course.deposit_token,
    )]
    pub course_deposit_token: Account<'info, TokenAccount>,
    pub deposit_token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

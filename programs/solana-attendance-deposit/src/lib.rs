mod program_accounts;
mod errors;

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use program_accounts::structs::*;
use program_accounts::contexts::*;
use errors::ErrorCode;

declare_id!("G8PAMHAVZVAzcsKAXVtuJ69msx9tB1tNYKRPoSCtZ54G");

#[program]
pub mod solana_attendance_deposit {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let course_manager = &mut ctx.accounts.authority;

        if course_manager.manager != Pubkey::default() {
            return Err(ErrorCode::UnauthorizedAccess.into());
        }

        course_manager.manager = ctx.accounts.signer.key();

        Ok(())
    }

    pub fn create_course(ctx: Context<NewCourse>, name: String, deposit: u64, lock_until: u64, num_of_lessons: u8) -> Result<()> {
        require_keys_eq!(ctx.accounts.manager.key(), ctx.accounts.authority.manager.key(), ErrorCode::UnauthorizedAccess);

        let course = &mut ctx.accounts.course;
        let deposit_token = ctx.accounts.deposit_token_mint.key();
        course.new(name, ctx.accounts.manager.key(), deposit, lock_until, num_of_lessons, deposit_token)
    }

    pub fn register(ctx: Context<Registration>) -> Result<()> {
        let course = &mut ctx.accounts.course;
        let student = &ctx.accounts.student;

        let student_balance = ctx.accounts.student_deposit_token.amount;
        if student_balance < course.deposit {
            return Err(ErrorCode::InsufficientUsdcDeposit.into());
        }

        let cpi_accounts = Transfer {
            from: ctx.accounts.student_deposit_token.to_account_info(),
            to: ctx.accounts.course_deposit_token.to_account_info(),
            authority: ctx.accounts.student.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, course.deposit)?;

        course.register(student.key())
    }

    pub fn create_lesson(ctx: Context<CreateLesson>, attendance_deadline: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.manager.key(), ctx.accounts.authority.manager.key(), ErrorCode::UnauthorizedAccess);

        let course = &mut ctx.accounts.course;
        let lesson = &mut ctx.accounts.lesson;

        lesson.new(course, attendance_deadline)
    }

    pub fn mark_attendance(ctx: Context<MarkAttendance>, lesson_id: u8) -> Result<()> {
        let course = &mut ctx.accounts.course;
        let student = &ctx.accounts.student;
        let attendance = &mut ctx.accounts.attendance;
        let lesson = &ctx.accounts.lesson;

        if !course.students.contains(&student.key()) {
            return Err(ErrorCode::StudentNotEnrolled.into());
        }

        if attendance.attendance.contains(&lesson_id) {
            return Err(ErrorCode::AttendanceAlreadyMarked.into());
        }

        let clock = Clock::get()?;
        if lesson.attendance_deadline < clock.unix_timestamp as u64 {
            return Err(ErrorCode::LateForLesson.into());
        }

        attendance.course = course.key();
        attendance.student = student.key();
        attendance.attendance.push(lesson_id);

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdrawal>, bump: u8) -> Result<()> {
        let course = &ctx.accounts.course;
        let attendance = &mut ctx.accounts.attendance;
        let student = &ctx.accounts.student;
        let student_usdc = &mut ctx.accounts.student_deposit_token;
        let course_usdc = &mut ctx.accounts.course_deposit_token;

        require!(course.students.contains(&student.key()), ErrorCode::StudentNotEnrolled);
        require!(course.lock_until < Clock::get()?.unix_timestamp as u64, ErrorCode::NotReadyForWithdrawal);

        let seeds = &[course.name.as_bytes(), &[bump]];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: course_usdc.to_account_info(),
            to: student_usdc.to_account_info(),
            authority: course.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

        token::transfer(cpi_ctx, course.deposit)?;

        attendance.withdrawn = true;

        Ok(())
    }
}

impl Lesson {
    pub fn new(&mut self, course: &mut Account<Course>, attendance_deadline: u64) -> Result<()> {
        let next_lesson_id = course.last_lesson_id + 1;

        if next_lesson_id > course.num_of_lessons {
            return Err(ErrorCode::ExceededCourseLessons.into());
        }

        course.last_lesson_id = next_lesson_id;
        self.course = course.key();
        self.lesson_id = next_lesson_id;
        self.attendance_deadline = attendance_deadline;

        Ok(())
    }
}

impl Course {
    pub fn new(&mut self, name: String, manager: Pubkey, deposit: u64, lock_until: u64, num_of_lessons: u8, deposit_token: Pubkey) -> Result<()> {
        self.name = name;
        self.manager = manager;
        self.deposit = deposit;
        self.lock_until = lock_until;
        self.num_of_lessons = num_of_lessons;
        self.last_lesson_id = 0;
        self.deposit_token = deposit_token;

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


use anchor_lang::prelude::*;

#[account]
pub struct Course {
    pub name: String,
    pub manager: Pubkey,
    pub students: Vec<Pubkey>,
    pub deposit: u64,
    pub lock_until: u64,
    pub num_of_lessons: u8,
    pub last_lesson_id: u8,
    pub deposit_token: Pubkey,
}

#[account]
pub struct CourseManager {
    pub manager: Pubkey,
}

#[account]
pub struct Lesson {
    pub course: Pubkey,
    pub lesson_id: u8,
    pub attendance_deadline: u64,
}

#[account]
pub struct Attendance {
    pub course: Pubkey,
    pub student: Pubkey,
    pub attendance: Vec<u8>,
    pub withdrawn: bool,
}

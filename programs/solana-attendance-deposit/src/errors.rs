use anchor_lang::error_code;

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
    ExceededCourseLessons,
    CreateLessonNotLatest,
    AttendanceAlreadyMarked,
    LateForLesson,
    NotReadyForWithdrawal,
}

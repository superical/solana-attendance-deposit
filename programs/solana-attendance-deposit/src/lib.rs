use anchor_lang::prelude::*;

declare_id!("G8PAMHAVZVAzcsKAXVtuJ69msx9tB1tNYKRPoSCtZ54G");

#[program]
pub mod solana_attendance_deposit {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

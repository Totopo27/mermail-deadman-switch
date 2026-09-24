use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("DMSvauLt11111111111111111111111111111111111");

#[program]
pub mod mermail_deadman_vault {
    use super::*;

    /// Initializes a new Dead Man's Switch Vault PDA for the owner.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        heartbeat_interval_seconds: i64,
        grace_period_seconds: i64,
        beneficiary: Pubkey,
        guardian: Option<Pubkey>,
    ) -> Result<()> {
        require!(heartbeat_interval_seconds > 0, DeadmanError::InvalidInterval);
        require!(grace_period_seconds > 0, DeadmanError::InvalidGracePeriod);

        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;

        vault.owner = ctx.accounts.owner.key();
        vault.beneficiary = beneficiary;
        vault.guardian = guardian;
        vault.heartbeat_interval_seconds = heartbeat_interval_seconds;
        vault.grace_period_seconds = grace_period_seconds;
        vault.last_heartbeat_timestamp = clock.unix_timestamp;
        vault.hold_until_timestamp = 0;
        vault.status = VaultStatus::Active;
        vault.bump = ctx.bumps.vault_account;

        msg!(
            "Dead Man's Switch Vault initialized for owner {}. Beneficiary: {}",
            vault.owner,
            vault.beneficiary
        );
        Ok(())
    }

    /// Owner pings the vault to reset the proof-of-life heartbeat.
    pub fn ping_heartbeat(ctx: Context<PingHeartbeat>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);

        let clock = Clock::get()?;
        vault.last_heartbeat_timestamp = clock.unix_timestamp;
        vault.hold_until_timestamp = 0;
        vault.status = VaultStatus::Active;

        msg!("Heartbeat refreshed on-chain at timestamp {}", vault.last_heartbeat_timestamp);
        Ok(())
    }

    /// Owner deposits SOL into the vault PDA.
    pub fn deposit_funds(ctx: Context<DepositFunds>, amount_lamports: u64) -> Result<()> {
        require!(amount_lamports > 0, DeadmanError::ZeroDeposit);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.vault_account.to_account_info(),
                },
            ),
            amount_lamports,
        )?;

        // Depositing also acts as active proof-of-life
        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        vault.last_heartbeat_timestamp = clock.unix_timestamp;

        msg!("Deposited {} lamports into vault PDA. Heartbeat reset.", amount_lamports);
        Ok(())
    }

    /// Owner can withdraw any amount of their funds anytime while alive.
    pub fn withdraw_funds(ctx: Context<WithdrawFunds>, amount_lamports: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_account;
        let vault_lamports = vault.to_account_info().lamports();
        let rent = Rent::get()?.minimum_balance(vault.to_account_info().data_len());

        require!(vault_lamports.saturating_sub(amount_lamports) >= rent, DeadmanError::InsufficientFunds);

        **vault.to_account_info().try_borrow_mut_lamports()? -= amount_lamports;
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += amount_lamports;

        msg!("Owner withdrew {} lamports from vault PDA", amount_lamports);
        Ok(())
    }

    /// Designated guardian places a temporary emergency hold (e.g. during hospitalization).
    pub fn apply_guardian_hold(ctx: Context<GuardianAction>, hold_seconds: i64) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);
        require!(hold_seconds > 0 && hold_seconds <= 30 * 86400, DeadmanError::InvalidHoldDuration);

        let clock = Clock::get()?;
        vault.hold_until_timestamp = clock.unix_timestamp + hold_seconds;
        vault.status = VaultStatus::GuardianHold;

        msg!(
            "Emergency guardian hold applied until timestamp {}",
            vault.hold_until_timestamp
        );
        Ok(())
    }

    /// Beneficiary claims the inheritance once the timelock mathematically expires.
    /// This requires NO server, NO email, and NO intermediaries.
    pub fn claim_inheritance(ctx: Context<ClaimInheritance>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // Mathematical invariant: Timelock must be fully expired
        let deadline = vault.last_heartbeat_timestamp
            .checked_add(vault.heartbeat_interval_seconds)
            .ok_or(DeadmanError::MathOverflow)?
            .checked_add(vault.grace_period_seconds)
            .ok_or(DeadmanError::MathOverflow)?;

        require!(now >= deadline, DeadmanError::TimelockNotExpired);
        require!(now >= vault.hold_until_timestamp, DeadmanError::GuardianHoldActive);

        // Lock vault irrevocably
        vault.status = VaultStatus::Triggered;

        // Transfer all available funds (keeping rent or emptying to beneficiary)
        let vault_info = vault.to_account_info();
        let beneficiary_info = ctx.accounts.beneficiary.to_account_info();
        let balance = vault_info.lamports();

        **vault_info.try_borrow_mut_lamports()? = 0;
        **beneficiary_info.try_borrow_mut_lamports()? = beneficiary_info
            .lamports()
            .checked_add(balance)
            .ok_or(DeadmanError::MathOverflow)?;

        msg!(
            "Contingency protocol executed on-chain! Transferred {} lamports to beneficiary {}",
            balance,
            vault.beneficiary
        );
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// ACCOUNT STRUCTURES & CONSTRAINTS
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + VaultAccount::INIT_SPACE,
        seeds = [b"deadman_vault", owner.key().as_ref()],
        bump
    )]
    pub vault_account: Account<'info, VaultAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PingHeartbeat<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", owner.key().as_ref()],
        bump = vault_account.bump,
        has_one = owner @ DeadmanError::UnauthorizedOwner
    )]
    pub vault_account: Account<'info, VaultAccount>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositFunds<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", owner.key().as_ref()],
        bump = vault_account.bump,
        has_one = owner @ DeadmanError::UnauthorizedOwner
    )]
    pub vault_account: Account<'info, VaultAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFunds<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", owner.key().as_ref()],
        bump = vault_account.bump,
        has_one = owner @ DeadmanError::UnauthorizedOwner
    )]
    pub vault_account: Account<'info, VaultAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct GuardianAction<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", vault_account.owner.as_ref()],
        bump = vault_account.bump,
        constraint = vault_account.guardian == Some(guardian.key()) @ DeadmanError::UnauthorizedGuardian
    )]
    pub vault_account: Account<'info, VaultAccount>,

    pub guardian: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimInheritance<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", vault_account.owner.as_ref()],
        bump = vault_account.bump,
        has_one = beneficiary @ DeadmanError::UnauthorizedBeneficiary
    )]
    pub vault_account: Account<'info, VaultAccount>,

    #[account(mut)]
    pub beneficiary: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct VaultAccount {
    pub owner: Pubkey,
    pub beneficiary: Pubkey,
    pub guardian: Option<Pubkey>,
    pub heartbeat_interval_seconds: i64,
    pub grace_period_seconds: i64,
    pub last_heartbeat_timestamp: i64,
    pub hold_until_timestamp: i64,
    pub status: VaultStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum VaultStatus {
    Active,
    GuardianHold,
    Triggered,
}

// ---------------------------------------------------------------------------
// ERROR CODES
// ---------------------------------------------------------------------------

#[error_code]
pub enum DeadmanError {
    #[msg("Heartbeat interval must be greater than 0")]
    InvalidInterval,
    #[msg("Grace period must be greater than 0")]
    InvalidGracePeriod,
    #[msg("Deposit amount must be greater than 0")]
    ZeroDeposit,
    #[msg("Insufficient funds remaining after withdrawal")]
    InsufficientFunds,
    #[msg("Vault is already in irreversible TRIGGERED state")]
    VaultAlreadyTriggered,
    #[msg("Emergency hold duration must be between 1 second and 30 days")]
    InvalidHoldDuration,
    #[msg("Timelock has not expired yet. The owner is still considered active.")]
    TimelockNotExpired,
    #[msg("An active guardian emergency hold is currently pausing this vault")]
    GuardianHoldActive,
    #[msg("Signer is not the authorized owner of this vault")]
    UnauthorizedOwner,
    #[msg("Signer is not the designated guardian of this vault")]
    UnauthorizedGuardian,
    #[msg("Signer is not the designated beneficiary of this vault")]
    UnauthorizedBeneficiary,
    #[msg("Mathematical overflow occurred")]
    MathOverflow,
}

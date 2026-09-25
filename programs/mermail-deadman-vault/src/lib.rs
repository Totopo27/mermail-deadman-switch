use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX");

pub const MAX_HOLD_SECONDS_PER_CALL: i64 = 30 * 86400; // 30 días
pub const MAX_CUMULATIVE_HOLD_SECONDS: i64 = 60 * 86400; // 60 días de prórroga total acumulativa

#[program]
pub mod mermail_deadman_vault {
    use super::*;

    /// Initializes a new Dead Man's Switch Vault PDA for the owner.
    /// Supports individual wallets OR Squads Multisig vaults for owner/beneficiary/guardian.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        heartbeat_interval_seconds: i64,
        grace_period_seconds: i64,
        beneficiary: Pubkey,
        guardian: Option<Pubkey>,
        oracle_attestation: Option<Pubkey>,
    ) -> Result<()> {
        require!(heartbeat_interval_seconds > 0, DeadmanError::InvalidInterval);
        require!(grace_period_seconds > 0, DeadmanError::InvalidGracePeriod);

        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;

        vault.owner = ctx.accounts.owner.key();
        vault.beneficiary = beneficiary;
        vault.guardian = guardian;
        vault.oracle_attestation = oracle_attestation;
        vault.heartbeat_interval_seconds = heartbeat_interval_seconds;
        vault.grace_period_seconds = grace_period_seconds;
        vault.last_heartbeat_timestamp = clock.unix_timestamp;
        vault.hold_until_timestamp = 0;
        vault.total_hold_seconds_consumed = 0;
        vault.oracle_certificate_hash = [0u8; 32];
        vault.oracle_dispute_until = 0;
        vault.status = VaultStatus::Active;
        vault.bump = ctx.bumps.vault_account;

        msg!(
            "Dead Man's Switch Vault initialized for owner {}. Beneficiary: {}. Oracle: {:?}",
            vault.owner,
            vault.beneficiary,
            vault.oracle_attestation
        );
        Ok(())
    }

    /// Owner (or Squads Multisig) pings the vault to reset the proof-of-life heartbeat.
    /// FIX 2: Cannot ping if vault is Triggered, and cannot arbitrarily clear an active Guardian Hold.
    pub fn ping_heartbeat(ctx: Context<PingHeartbeat>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);
        
        // Si hay una pausa médica activa del guardián, el ping del owner no la destruye a ciegas
        if vault.status == VaultStatus::GuardianHold && now < vault.hold_until_timestamp {
            return Err(DeadmanError::GuardianHoldActive.into());
        }

        // FIX 5: Si el oráculo inició un trigger pero el owner está vivo dentro del período de disputa
        if vault.status == VaultStatus::OracleDisputePending {
            require!(now <= vault.oracle_dispute_until, DeadmanError::VaultAlreadyTriggered);
            msg!("Owner proves life during dispute window! Reverting false oracle trigger to Active.");
            vault.oracle_certificate_hash = [0u8; 32];
            vault.oracle_dispute_until = 0;
        }

        vault.last_heartbeat_timestamp = now;
        vault.hold_until_timestamp = 0;
        vault.status = VaultStatus::Active;

        msg!("Heartbeat refreshed on-chain at timestamp {}", vault.last_heartbeat_timestamp);
        Ok(())
    }

    /// Owner deposits SOL into the vault PDA.
    /// FIX 1: Cannot deposit into an already Triggered vault.
    pub fn deposit_funds(ctx: Context<DepositFunds>, amount_lamports: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_account;
        require!(amount_lamports > 0, DeadmanError::ZeroDeposit);
        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);

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

        // Depositing also acts as active proof-of-life if not under dispute
        let vault_mut = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        vault_mut.last_heartbeat_timestamp = clock.unix_timestamp;

        msg!("Deposited {} lamports into vault PDA. Heartbeat reset.", amount_lamports);
        Ok(())
    }

    /// Owner can withdraw any amount of their funds anytime while alive.
    /// FIX 1: Strictly forbids withdrawal if the vault has been Triggered.
    pub fn withdraw_funds(ctx: Context<WithdrawFunds>, amount_lamports: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_account;
        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);
        require!(vault.status != VaultStatus::OracleDisputePending, DeadmanError::OracleDisputeActive);

        let vault_lamports = vault.to_account_info().lamports();
        let rent = Rent::get()?.minimum_balance(vault.to_account_info().data_len());

        require!(vault_lamports.saturating_sub(amount_lamports) >= rent, DeadmanError::InsufficientFunds);

        **vault.to_account_info().try_borrow_mut_lamports()? -= amount_lamports;
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += amount_lamports;

        msg!("Owner withdrew {} lamports from vault PDA", amount_lamports);
        Ok(())
    }

    /// Designated guardian (or Guardian Squads multisig) places a temporary emergency hold.
    /// FIX 4: Prevents infinite griefing by enforcing a strict cumulative cap (max 60 days total).
    pub fn apply_guardian_hold(ctx: Context<GuardianAction>, hold_seconds: i64) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);
        require!(
            hold_seconds > 0 && hold_seconds <= MAX_HOLD_SECONDS_PER_CALL,
            DeadmanError::InvalidHoldDuration
        );

        let new_cumulative = vault.total_hold_seconds_consumed
            .checked_add(hold_seconds)
            .ok_or(DeadmanError::MathOverflow)?;

        require!(
            new_cumulative <= MAX_CUMULATIVE_HOLD_SECONDS,
            DeadmanError::CumulativeHoldLimitExceeded
        );

        let clock = Clock::get()?;
        vault.hold_until_timestamp = clock.unix_timestamp + hold_seconds;
        vault.total_hold_seconds_consumed = new_cumulative;
        vault.status = VaultStatus::GuardianHold;

        msg!(
            "Emergency guardian hold applied until timestamp {}. Cumulative consumed: {}s/{}s",
            vault.hold_until_timestamp,
            vault.total_hold_seconds_consumed,
            MAX_CUMULATIVE_HOLD_SECONDS
        );
        Ok(())
    }

    /// Authorized legal or medical oracle certifies death/incapacitation with an on-chain attestation.
    /// FIX 3: Certificate hash is stored permanently on-chain for immutable auditability.
    /// FIX 5: Enters OracleDisputePending (48h safety dispute window) so a living owner can ping and dispute a false trigger.
    pub fn attest_oracle_trigger(ctx: Context<OracleAttestation>, certificate_hash: [u8; 32]) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);
        require!(certificate_hash != [0u8; 32], DeadmanError::InvalidCertificateHash);

        let clock = Clock::get()?;
        vault.oracle_certificate_hash = certificate_hash;
        vault.oracle_dispute_until = clock.unix_timestamp + 48 * 3600; // 48 horas de ventana de seguridad
        vault.status = VaultStatus::OracleDisputePending;

        msg!(
            "Oracle attestation verified! Stored certificate hash: {:?}. 48h dispute window open until: {}",
            vault.oracle_certificate_hash,
            vault.oracle_dispute_until
        );
        Ok(())
    }

    /// Beneficiary claims the inheritance once the timelock mathematically expires
    /// OR once an authorized oracle dispute window has safely expired.
    pub fn claim_inheritance(ctx: Context<ClaimInheritance>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // If triggered via Oracle, must pass the 48h dispute window safely
        if vault.status == VaultStatus::OracleDisputePending {
            require!(now >= vault.oracle_dispute_until, DeadmanError::OracleDisputeActive);
            vault.status = VaultStatus::Triggered;
        }

        // If not already triggered, verify standard mathematical timelock
        if vault.status != VaultStatus::Triggered {
            let deadline = vault.last_heartbeat_timestamp
                .checked_add(vault.heartbeat_interval_seconds)
                .ok_or(DeadmanError::MathOverflow)?
                .checked_add(vault.grace_period_seconds)
                .ok_or(DeadmanError::MathOverflow)?;

            require!(now >= deadline, DeadmanError::TimelockNotExpired);
            require!(now >= vault.hold_until_timestamp, DeadmanError::GuardianHoldActive);

            vault.status = VaultStatus::Triggered;
        }

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
pub struct OracleAttestation<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", vault_account.owner.as_ref()],
        bump = vault_account.bump,
        constraint = vault_account.oracle_attestation == Some(oracle.key()) @ DeadmanError::UnauthorizedOracle
    )]
    pub vault_account: Account<'info, VaultAccount>,

    pub oracle: Signer<'info>,
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
    pub oracle_attestation: Option<Pubkey>,
    pub heartbeat_interval_seconds: i64,
    pub grace_period_seconds: i64,
    pub last_heartbeat_timestamp: i64,
    pub hold_until_timestamp: i64,
    pub total_hold_seconds_consumed: i64,      // FIX 4: Límite acumulativo contra griefing
    pub oracle_certificate_hash: [u8; 32],     // FIX 3: Hash inmutable guardado on-chain
    pub oracle_dispute_until: i64,             // FIX 5: Ventana de seguridad para revertir falsos positivos
    pub status: VaultStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum VaultStatus {
    Active,
    GuardianHold,
    OracleDisputePending,
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
    #[msg("Guardian cumulative hold limit of 60 days exceeded (anti-griefing)")]
    CumulativeHoldLimitExceeded,
    #[msg("Timelock has not expired yet. The owner is still considered active.")]
    TimelockNotExpired,
    #[msg("An active guardian emergency hold is currently pausing this vault")]
    GuardianHoldActive,
    #[msg("Oracle dispute window is still active; claim must wait for dispute expiration")]
    OracleDisputeActive,
    #[msg("Oracle certificate hash cannot be empty or zero")]
    InvalidCertificateHash,
    #[msg("Signer is not the authorized owner of this vault")]
    UnauthorizedOwner,
    #[msg("Signer is not the designated guardian of this vault")]
    UnauthorizedGuardian,
    #[msg("Signer is not the designated beneficiary of this vault")]
    UnauthorizedBeneficiary,
    #[msg("Signer is not the authorized legal or medical oracle")]
    UnauthorizedOracle,
    #[msg("Mathematical overflow occurred")]
    MathOverflow,
}

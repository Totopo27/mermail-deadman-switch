use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use pyth_sdk_solana::load_price_feed_from_account_info;

declare_id!("E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX");

pub const MAX_HOLD_SECONDS_PER_CALL: i64 = 30 * 86400; // 30 días
pub const MAX_CUMULATIVE_HOLD_SECONDS: i64 = 60 * 86400; // 60 días acumulativos totales
pub const MAXIMUM_PRICE_AGE_SECONDS: u64 = 120; // Máxima antigüedad permitida del oráculo Pyth (2 min)
pub const MAXIMUM_PRICE_CONFIDENCE_BPS: u128 = 300; // Máxima dispersión de confianza (3% = 300 bps)

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
        pyth_price_feed: Option<Pubkey>,
    ) -> Result<()> {
        require!(heartbeat_interval_seconds > 0, DeadmanError::InvalidInterval);
        require!(grace_period_seconds > 0, DeadmanError::InvalidGracePeriod);

        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;

        vault.owner = ctx.accounts.owner.key();
        vault.beneficiary = beneficiary;
        vault.guardian = guardian;
        vault.oracle_attestation = oracle_attestation;
        vault.pyth_price_feed = pyth_price_feed;
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
            "Vault initialized for owner {}. Beneficiary: {}. Pyth feed: {:?}",
            vault.owner,
            vault.beneficiary,
            vault.pyth_price_feed
        );
        Ok(())
    }

    /// Living owner updates vault parameters (guardian, oracle attestation, price feed, or intervals).
    pub fn update_vault_config(
        ctx: Context<UpdateVaultConfig>,
        new_heartbeat_interval_seconds: Option<i64>,
        new_grace_period_seconds: Option<i64>,
        new_guardian: Option<Option<Pubkey>>,
        new_oracle_attestation: Option<Option<Pubkey>>,
        new_pyth_price_feed: Option<Option<Pubkey>>,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        require!(vault.status == VaultStatus::Active, DeadmanError::VaultNotActive);

        if let Some(interval) = new_heartbeat_interval_seconds {
            require!(interval > 0, DeadmanError::InvalidInterval);
            vault.heartbeat_interval_seconds = interval;
        }

        if let Some(grace) = new_grace_period_seconds {
            require!(grace > 0, DeadmanError::InvalidGracePeriod);
            vault.grace_period_seconds = grace;
        }

        if let Some(guardian) = new_guardian {
            vault.guardian = guardian;
        }

        if let Some(oracle) = new_oracle_attestation {
            vault.oracle_attestation = oracle;
        }

        if let Some(feed) = new_pyth_price_feed {
            vault.pyth_price_feed = feed;
        }

        let clock = Clock::get()?;
        vault.last_heartbeat_timestamp = clock.unix_timestamp;

        msg!("Vault configuration updated by owner {}. Heartbeat reset.", vault.owner);
        Ok(())
    }

    /// Owner (or Squads Multisig) pings the vault to reset the proof-of-life heartbeat.
    pub fn ping_heartbeat(ctx: Context<PingHeartbeat>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);
        
        // Cannot clear an active guardian hold
        if vault.status == VaultStatus::GuardianHold && now < vault.hold_until_timestamp {
            return Err(DeadmanError::GuardianHoldActive.into());
        }

        // Revert oracle dispute if within the 48h safety window
        if vault.status == VaultStatus::OracleDisputePending {
            require!(now <= vault.oracle_dispute_until, DeadmanError::VaultAlreadyTriggered);
            msg!("Owner proves life! Reverting false oracle trigger to Active.");
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

        let vault_mut = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        vault_mut.last_heartbeat_timestamp = clock.unix_timestamp;

        msg!("Deposited {} lamports into vault PDA. Heartbeat reset.", amount_lamports);
        Ok(())
    }

    /// Owner can withdraw any amount of their funds anytime while alive, preserving rent exemption.
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

    /// SPL TOKEN SUPPORT: Owner deposits SPL Tokens into the vault's token account using TransferChecked.
    pub fn deposit_spl_tokens(ctx: Context<DepositSplTokens>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_account;
        require!(amount > 0, DeadmanError::ZeroDeposit);
        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.owner_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer_checked(
            CpiContext::new(cpi_program, cpi_accounts),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        // Reset heartbeat on token deposit
        let vault_mut = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        vault_mut.last_heartbeat_timestamp = clock.unix_timestamp;

        msg!("Deposited {} SPL tokens into vault token account. Heartbeat reset.", amount);
        Ok(())
    }

    /// SPL TOKEN SUPPORT: Owner withdraws SPL Tokens while active using TransferChecked.
    pub fn withdraw_spl_tokens(ctx: Context<WithdrawSplTokens>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_account;
        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);
        require!(vault.status != VaultStatus::OracleDisputePending, DeadmanError::OracleDisputeActive);

        let owner_key = vault.owner.key();
        let seeds = &[
            b"deadman_vault",
            owner_key.as_ref(),
            &[vault.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.owner_token_account.to_account_info(),
            authority: ctx.accounts.vault_account.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        msg!("Owner withdrew {} SPL tokens from vault", amount);
        Ok(())
    }

    /// Designated guardian places a temporary emergency hold with cumulative cap.
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
            "Emergency guardian hold applied until timestamp {}. Cumulative: {}s/{}s",
            vault.hold_until_timestamp,
            vault.total_hold_seconds_consumed,
            MAX_CUMULATIVE_HOLD_SECONDS
        );
        Ok(())
    }

    /// Authorized legal or medical oracle certifies death/incapacitation with an on-chain attestation.
    pub fn attest_oracle_trigger(ctx: Context<OracleAttestation>, certificate_hash: [u8; 32]) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        require!(vault.status != VaultStatus::Triggered, DeadmanError::VaultAlreadyTriggered);
        require!(certificate_hash != [0u8; 32], DeadmanError::InvalidCertificateHash);

        let clock = Clock::get()?;
        vault.oracle_certificate_hash = certificate_hash;
        vault.oracle_dispute_until = clock.unix_timestamp + 48 * 3600;
        vault.status = VaultStatus::OracleDisputePending;

        msg!(
            "Oracle attestation verified! Stored certificate hash: {:?}. 48h dispute open.",
            vault.oracle_certificate_hash
        );
        Ok(())
    }

    /// PYTH ORACLE INTEGRATION: Queries on-chain Pyth price feed, validates owner, positive price & confidence band.
    pub fn inspect_pyth_valuation(ctx: Context<InspectPythValuation>) -> Result<()> {
        let vault = &ctx.accounts.vault_account;
        let pyth_account_info = &ctx.accounts.pyth_price_account;

        require!(
            vault.pyth_price_feed == Some(pyth_account_info.key()),
            DeadmanError::MismatchedPriceFeed
        );

        let price_feed = load_price_feed_from_account_info(pyth_account_info)
            .map_err(|_| DeadmanError::PythFeedParseError)?;

        let clock = Clock::get()?;
        let current_price = price_feed
            .get_price_no_older_than(clock.unix_timestamp, MAXIMUM_PRICE_AGE_SECONDS)
            .ok_or(DeadmanError::StalePriceFeed)?;

        // Ensure price is positive (prevent sign-flip attacks when casting)
        require!(current_price.price > 0, DeadmanError::InvalidPrice);

        // Enforce confidence interval ratio (conf / price <= 3%)
        let conf_bps = (current_price.conf as u128)
            .checked_mul(10_000)
            .ok_or(DeadmanError::MathOverflow)?
            .checked_div(current_price.price as u128)
            .ok_or(DeadmanError::MathOverflow)?;
        require!(
            conf_bps <= MAXIMUM_PRICE_CONFIDENCE_BPS,
            DeadmanError::PriceConfidenceTooWide
        );

        msg!(
            "Pyth on-chain valuation: SOL/USD price = {}. Exponent = {}. Confidence = {} ({} bps)",
            current_price.price,
            current_price.expo,
            current_price.conf,
            conf_bps
        );
        Ok(())
    }

    /// Beneficiary claims the SOL inheritance once timelock/dispute expires, retaining rent exemption for PDA survival.
    pub fn claim_inheritance(ctx: Context<ClaimInheritance>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        if vault.status == VaultStatus::OracleDisputePending {
            require!(now >= vault.oracle_dispute_until, DeadmanError::OracleDisputeActive);
            vault.status = VaultStatus::Triggered;
        }

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
        let current_balance = vault_info.lamports();
        let rent_minimum = Rent::get()?.minimum_balance(vault_info.data_len());

        let claimable_lamports = current_balance.saturating_sub(rent_minimum);
        require!(claimable_lamports > 0, DeadmanError::InsufficientFunds);

        **vault_info.try_borrow_mut_lamports()? -= claimable_lamports;
        **beneficiary_info.try_borrow_mut_lamports()? = beneficiary_info
            .lamports()
            .checked_add(claimable_lamports)
            .ok_or(DeadmanError::MathOverflow)?;

        msg!(
            "Inheritance SOL claimed! Transferred {} lamports to beneficiary {} (retaining {} rent-exempt lamports)",
            claimable_lamports,
            vault.beneficiary,
            rent_minimum
        );
        Ok(())
    }

    /// SPL TOKEN SUPPORT: Beneficiary claims all custodied SPL Tokens using TransferChecked.
    /// Can trigger the transition autonomously if timelock has expired.
    pub fn claim_spl_inheritance(ctx: Context<ClaimSplInheritance>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_account;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        if vault.status == VaultStatus::OracleDisputePending {
            require!(now >= vault.oracle_dispute_until, DeadmanError::OracleDisputeActive);
            vault.status = VaultStatus::Triggered;
        }

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

        let token_balance = ctx.accounts.vault_token_account.amount;
        require!(token_balance > 0, DeadmanError::NoTokensToClaim);

        let owner_key = vault.owner.key();
        let seeds = &[
            b"deadman_vault",
            owner_key.as_ref(),
            &[vault.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.beneficiary_token_account.to_account_info(),
            authority: ctx.accounts.vault_account.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer_checked(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
            token_balance,
            ctx.accounts.mint.decimals,
        )?;

        msg!("Transferred {} SPL tokens to beneficiary token account", token_balance);
        Ok(())
    }

    /// Closes the vault account after final claim and returns remaining rent lamports to beneficiary.
    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        let vault = &ctx.accounts.vault_account;
        require!(vault.status == VaultStatus::Triggered, DeadmanError::VaultNotTriggered);

        msg!("Vault closed permanently. Rent lamports refunded to beneficiary.");
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
pub struct UpdateVaultConfig<'info> {
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
pub struct DepositSplTokens<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", owner.key().as_ref()],
        bump = vault_account.bump,
        has_one = owner @ DeadmanError::UnauthorizedOwner
    )]
    pub vault_account: Account<'info, VaultAccount>,

    #[account(
        mut,
        constraint = vault_token_account.owner == vault_account.key() @ DeadmanError::InvalidTokenAccountOwner,
        constraint = vault_token_account.mint == mint.key() @ DeadmanError::MismatchedMint
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key() @ DeadmanError::UnauthorizedOwner,
        constraint = owner_token_account.mint == mint.key() @ DeadmanError::MismatchedMint
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawSplTokens<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", owner.key().as_ref()],
        bump = vault_account.bump,
        has_one = owner @ DeadmanError::UnauthorizedOwner
    )]
    pub vault_account: Account<'info, VaultAccount>,

    #[account(
        mut,
        constraint = vault_token_account.owner == vault_account.key() @ DeadmanError::InvalidTokenAccountOwner,
        constraint = vault_token_account.mint == mint.key() @ DeadmanError::MismatchedMint
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = owner_token_account.owner == owner.key() @ DeadmanError::UnauthorizedOwner,
        constraint = owner_token_account.mint == mint.key() @ DeadmanError::MismatchedMint
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
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
pub struct InspectPythValuation<'info> {
    #[account(
        seeds = [b"deadman_vault", vault_account.owner.as_ref()],
        bump = vault_account.bump
    )]
    pub vault_account: Account<'info, VaultAccount>,

    /// CHECK: Validated against vault_account.pyth_price_feed
    pub pyth_price_account: AccountInfo<'info>,
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

#[derive(Accounts)]
pub struct ClaimSplInheritance<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", vault_account.owner.as_ref()],
        bump = vault_account.bump,
        has_one = beneficiary @ DeadmanError::UnauthorizedBeneficiary
    )]
    pub vault_account: Account<'info, VaultAccount>,

    #[account(
        mut,
        constraint = vault_token_account.owner == vault_account.key() @ DeadmanError::InvalidTokenAccountOwner,
        constraint = vault_token_account.mint == mint.key() @ DeadmanError::MismatchedMint
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = beneficiary_token_account.owner == beneficiary.key() @ DeadmanError::UnauthorizedBeneficiary,
        constraint = beneficiary_token_account.mint == mint.key() @ DeadmanError::MismatchedMint
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub beneficiary: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(
        mut,
        seeds = [b"deadman_vault", vault_account.owner.as_ref()],
        bump = vault_account.bump,
        has_one = beneficiary @ DeadmanError::UnauthorizedBeneficiary,
        close = beneficiary
    )]
    pub vault_account: Account<'info, VaultAccount>,

    #[account(mut)]
    pub beneficiary: Signer<'info>,
}

// ---------------------------------------------------------------------------
// DATA STRUCTS & STATE ENUMS
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct VaultAccount {
    pub owner: Pubkey,
    pub beneficiary: Pubkey,
    pub guardian: Option<Pubkey>,
    pub oracle_attestation: Option<Pubkey>,
    pub pyth_price_feed: Option<Pubkey>,       // Pyth Network SOL/USD price feed
    pub heartbeat_interval_seconds: i64,
    pub grace_period_seconds: i64,
    pub last_heartbeat_timestamp: i64,
    pub hold_until_timestamp: i64,
    pub total_hold_seconds_consumed: i64,      // Límite acumulativo contra griefing
    pub oracle_certificate_hash: [u8; 32],     // Hash de defunción auditado
    pub oracle_dispute_until: i64,             // Ventana de 48h de disputa de seguridad
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
    #[msg("Mismatched Pyth price feed account")]
    MismatchedPriceFeed,
    #[msg("Failed to parse Pyth price feed account")]
    PythFeedParseError,
    #[msg("Pyth price feed is stale (older than 120 seconds)")]
    StalePriceFeed,
    #[msg("Price reported by oracle is invalid or non-positive")]
    InvalidPrice,
    #[msg("Oracle price confidence interval is too wide (high volatility)")]
    PriceConfidenceTooWide,
    #[msg("Token account mint does not match the provided mint")]
    MismatchedMint,
    #[msg("Vault is not in Triggered state")]
    VaultNotTriggered,
    #[msg("Vault is not in active state for configuration update")]
    VaultNotActive,
    #[msg("No tokens available in vault token account to claim")]
    NoTokensToClaim,
    #[msg("Invalid token account owner (must be owned by vault PDA)")]
    InvalidTokenAccountOwner,
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

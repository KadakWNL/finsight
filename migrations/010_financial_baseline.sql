CREATE TABLE public.customer (
    customer_id uuid PRIMARY KEY,
    user_id uuid UNIQUE,
    full_name varchar(200),
    date_of_birth date,
    email varchar(320),
    phone varchar(32),
    country_code char(2) NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('active', 'dormant', 'closed')),
    kyc_verified_on date,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.address (
    address_id uuid PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES public.customer ON DELETE RESTRICT,
    line1 varchar(250) NOT NULL,
    city varchar(100) NOT NULL,
    state varchar(100),
    postal_code varchar(20),
    country_code char(2) NOT NULL,
    latitude numeric,
    longitude numeric,
    is_primary boolean NOT NULL DEFAULT false
);

CREATE TABLE public.account (
    account_id uuid PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES public.customer ON DELETE RESTRICT,
    account_number varchar(40) NOT NULL UNIQUE,
    account_type varchar(16) NOT NULL CHECK (account_type IN ('savings', 'current', 'wallet')),
    currency_code char(3) NOT NULL CHECK (currency_code IN ('INR', 'USD')),
    balance numeric(20,2) NOT NULL CHECK (balance >= 0 AND balance < 'Infinity'::numeric),
    status varchar(16) NOT NULL CHECK (status IN ('active', 'frozen', 'closed', 'dormant')),
    opened_at date NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (account_id, currency_code)
);

CREATE TABLE public.payment_method (
    method_id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES public.account ON DELETE RESTRICT,
    method_type varchar(20) NOT NULL CHECK (method_type IN ('card', 'bank_transfer', 'wallet', 'upi')),
    token varchar(200) NOT NULL,
    last4 char(4),
    expiry_date date,
    status varchar(16) NOT NULL CHECK (status IN ('active', 'expired', 'blocked')),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (method_id, account_id)
);

CREATE TABLE public.merchant (
    merchant_id uuid PRIMARY KEY,
    merchant_name varchar(200) NOT NULL,
    category_code varchar(4) NOT NULL,
    country_code char(2) NOT NULL,
    city varchar(100),
    latitude numeric,
    longitude numeric,
    risk_tier varchar(8) NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
    is_watchlisted boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.device_fingerprint (
    device_id uuid PRIMARY KEY,
    device_hash char(64) NOT NULL UNIQUE,
    os_family varchar(40) NOT NULL,
    first_seen_country char(2),
    first_seen_at timestamptz NOT NULL
);

CREATE TABLE public.transaction (
    transaction_id uuid PRIMARY KEY,
    account_id uuid NOT NULL,
    method_id uuid,
    merchant_id uuid NOT NULL REFERENCES public.merchant ON DELETE RESTRICT,
    device_id uuid NOT NULL REFERENCES public.device_fingerprint ON DELETE RESTRICT,
    amount numeric(20,2) NOT NULL CHECK (amount > 0 AND amount < 'Infinity'::numeric),
    currency_code char(3) NOT NULL CHECK (currency_code IN ('INR', 'USD')),
    exchange_rate numeric(20,8) NOT NULL CHECK (exchange_rate > 0 AND exchange_rate < 'Infinity'::numeric),
    amount_base numeric(20,2) GENERATED ALWAYS AS (round(amount * exchange_rate, 2)) STORED,
    direction varchar(8) NOT NULL CHECK (direction IN ('debit', 'credit')),
    txn_type varchar(20) NOT NULL CHECK (txn_type = 'card_payment'),
    status varchar(16) NOT NULL CHECK (status IN ('posted', 'pending', 'reversed', 'blocked')),
    occurred_at timestamptz NOT NULL,
    merchant_country_code char(2) NOT NULL,
    merchant_city varchar(100),
    latitude numeric,
    longitude numeric,
    description text NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, description)) STORED,
    CHECK (currency_code <> 'INR' OR exchange_rate = 1),
    FOREIGN KEY (account_id, currency_code) REFERENCES public.account (account_id, currency_code) ON DELETE RESTRICT,
    FOREIGN KEY (method_id, account_id) REFERENCES public.payment_method (method_id, account_id) ON DELETE RESTRICT
);

CREATE TABLE public.risk_rule (
    rule_id uuid PRIMARY KEY,
    rule_code varchar(64) NOT NULL UNIQUE,
    rule_name varchar(200) NOT NULL,
    dimension varchar(16) NOT NULL CHECK (dimension IN ('amount', 'location', 'device', 'time', 'frequency', 'merchant')),
    weight numeric NOT NULL CHECK (weight >= 0 AND weight <= 100 AND weight = trunc(weight)),
    threshold_value numeric NOT NULL CHECK (threshold_value >= 0 AND threshold_value < 'Infinity'::numeric),
    is_active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE public.risk_signal (
    signal_id uuid PRIMARY KEY,
    transaction_id uuid NOT NULL REFERENCES public.transaction ON DELETE RESTRICT,
    rule_id uuid NOT NULL REFERENCES public.risk_rule ON DELETE RESTRICT,
    observed_value numeric NOT NULL CHECK (observed_value >= 0 AND observed_value < 'Infinity'::numeric),
    score_contribution numeric NOT NULL CHECK (score_contribution >= 0 AND score_contribution <= 100 AND score_contribution = trunc(score_contribution)),
    evidence text NOT NULL CHECK (length(btrim(evidence)) > 0),
    triggered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (transaction_id, rule_id)
);

CREATE TABLE public.fraud_scenario (
    scenario_id uuid PRIMARY KEY,
    scenario_code varchar(64) NOT NULL UNIQUE,
    scenario_name varchar(200) NOT NULL,
    description text NOT NULL
);

CREATE TABLE public.transaction_label (
    transaction_id uuid PRIMARY KEY REFERENCES public.transaction ON DELETE RESTRICT,
    scenario_id uuid NOT NULL REFERENCES public.fraud_scenario ON DELETE RESTRICT,
    is_suspicious boolean NOT NULL
);

REVOKE ALL ON TABLE public.customer, public.address, public.account,
    public.payment_method, public.merchant, public.device_fingerprint,
    public.transaction, public.risk_rule, public.risk_signal,
    public.fraud_scenario, public.transaction_label FROM PUBLIC;

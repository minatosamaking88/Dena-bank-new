import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Account = {
  accountNumber: string
  fullName: string
  email: string
  balanceCents: number
  withdrawnTodayCents: number
  withdrawalLimitCents: number
}

type ApiResponse<T> = {
  account?: T
  message?: string
}

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const body = (await response.json()) as ApiResponse<T>

  if (!response.ok) {
    throw new Error(body.message ?? 'Something went wrong. Please try again.')
  }

  return body.account as T
}

function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [mode, setMode] = useState<'login' | 'create'>('login')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [loginForm, setLoginForm] = useState({ accountNumber: '', pin: '' })
  const [createForm, setCreateForm] = useState({ fullName: '', email: '', pin: '' })
  const [amount, setAmount] = useState('')

  useEffect(() => {
    request<Account>('/api/account')
      .then(setAccount)
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  const remainingLimitCents = useMemo(
    () =>
      Math.max(0, (account?.withdrawalLimitCents ?? 50000) - (account?.withdrawnTodayCents ?? 0)),
    [account],
  )

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      setAccount(
        await request<Account>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(loginForm),
        }),
      )
      setNotice({ type: 'success', text: 'Welcome back. Your account is ready.' })
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to sign in.',
      })
    } finally {
      setBusy(false)
    }
  }

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      const created = await request<Account>('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(createForm),
      })
      setAccount(created)
      setNotice({ type: 'success', text: `Account ${created.accountNumber} is ready to use.` })
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to create your account.',
      })
    } finally {
      setBusy(false)
    }
  }

  const submitTransaction = async (kind: 'deposit' | 'withdraw') => {
    setBusy(true)
    setNotice(null)
    try {
      const updated = await request<Account>(`/api/account/${kind}`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      })
      setAccount(updated)
      setAmount('')
      setNotice({
        type: 'success',
        text: `${kind === 'deposit' ? 'Deposit' : 'Withdrawal'} complete. Your balance is ${formatCurrency(updated.balanceCents)}.`,
      })
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Transaction failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    await request<null>('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    setAccount(null)
    setMode('login')
    setNotice({ type: 'success', text: 'You have been signed out securely.' })
  }

  if (loading) {
    return (
      <main className="shell loading-shell">
        <span className="spinner" aria-hidden="true" />
        Loading your account…
      </main>
    )
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Dena Bank home">
          <span className="brand-mark" aria-hidden="true">
            D
          </span>
          <span>Dena Bank</span>
        </a>
        <span className="secure-label">
          <span className="secure-dot" aria-hidden="true" />
          Private banking
        </span>
      </header>

      {!account ? (
        <section className="auth-layout" aria-labelledby="auth-title">
          <div className="intro-copy">
            <p className="eyebrow">Your money, clearly</p>
            <h1 id="auth-title">A calmer way to bank.</h1>
            <p className="intro-text">
              Keep your everyday finances in view with a secure, straightforward account built
              around you.
            </p>
            <div className="trust-note">
              <span className="pulse-rail" aria-hidden="true" />
              <span>Simple balances. Clear decisions. No noise.</span>
            </div>
          </div>
          <div className="auth-card panel">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Dena Bank access</p>
                <h2>{mode === 'login' ? 'Welcome back' : 'Open your account'}</h2>
              </div>
              <span className="card-index">{mode === 'login' ? '01' : '02'}</span>
            </div>
            {mode === 'login' ? (
              <form onSubmit={submitLogin} className="form-stack">
                <label>
                  Account number
                  <input
                    required
                    inputMode="numeric"
                    value={loginForm.accountNumber}
                    onChange={(event) =>
                      setLoginForm({ ...loginForm, accountNumber: event.target.value })
                    }
                    placeholder="e.g. 480 219 67"
                  />
                </label>
                <label>
                  4-digit PIN
                  <input
                    required
                    minLength={4}
                    maxLength={4}
                    inputMode="numeric"
                    type="password"
                    value={loginForm.pin}
                    onChange={(event) =>
                      setLoginForm({ ...loginForm, pin: event.target.value.replace(/\D/g, '') })
                    }
                    placeholder="••••"
                  />
                </label>
                <button className="primary-button" disabled={busy} type="submit">
                  {busy ? 'Checking…' : 'Sign in'}
                  <span aria-hidden="true">→</span>
                </button>
                <p className="form-switch">
                  New to Dena Bank?{' '}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setMode('create')
                      setNotice(null)
                    }}
                  >
                    Create an account
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={submitCreate} className="form-stack">
                <label>
                  Full name
                  <input
                    required
                    value={createForm.fullName}
                    onChange={(event) =>
                      setCreateForm({ ...createForm, fullName: event.target.value })
                    }
                    placeholder="Jordan Lee"
                  />
                </label>
                <label>
                  Email address
                  <input
                    required
                    type="email"
                    value={createForm.email}
                    onChange={(event) =>
                      setCreateForm({ ...createForm, email: event.target.value })
                    }
                    placeholder="you@example.com"
                  />
                </label>
                <label>
                  Choose a 4-digit PIN
                  <input
                    required
                    minLength={4}
                    maxLength={4}
                    inputMode="numeric"
                    type="password"
                    value={createForm.pin}
                    onChange={(event) =>
                      setCreateForm({ ...createForm, pin: event.target.value.replace(/\D/g, '') })
                    }
                    placeholder="••••"
                  />
                </label>
                <button className="primary-button" disabled={busy} type="submit">
                  {busy ? 'Opening…' : 'Open account'}
                  <span aria-hidden="true">→</span>
                </button>
                <p className="form-switch">
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setMode('login')
                      setNotice(null)
                    }}
                  >
                    Sign in
                  </button>
                </p>
              </form>
            )}
            {notice && (
              <div className={`notice ${notice.type}`} role="status">
                {notice.text}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="dashboard" aria-labelledby="dashboard-title">
          <div className="dashboard-heading">
            <div>
              <p className="eyebrow">Good to see you, {account.fullName.split(' ')[0]}</p>
              <h1 id="dashboard-title">Your account at a glance.</h1>
            </div>
            <button className="text-button sign-out" type="button" onClick={signOut}>
              Sign out <span aria-hidden="true">↗</span>
            </button>
          </div>
          {notice && (
            <div className={`notice ${notice.type}`} role="status">
              {notice.text}
            </div>
          )}
          <div className="dashboard-grid">
            <article className="balance-card panel">
              <div className="balance-label">
                <span className="pulse-rail" aria-hidden="true" />
                Available balance
              </div>
              <strong className="balance-amount">{formatCurrency(account.balanceCents)}</strong>
              <div className="account-meta">
                <span>Account {account.accountNumber}</span>
                <span className="status-chip">
                  <span className="secure-dot" aria-hidden="true" />
                  Active
                </span>
              </div>
            </article>
            <aside className="limit-card panel">
              <p className="eyebrow">Withdrawal limit</p>
              <strong>{formatCurrency(remainingLimitCents)}</strong>
              <p>remaining today</p>
              <div
                className="limit-bar"
                aria-label={`${formatCurrency(remainingLimitCents)} withdrawal limit remaining`}
              >
                <span style={{ width: `${Math.min(100, (remainingLimitCents / 50000) * 100)}%` }} />
              </div>
            </aside>
          </div>
          <div className="activity-layout">
            <section className="panel transaction-panel" aria-labelledby="move-money-title">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Move money</p>
                  <h2 id="move-money-title">Make a transaction</h2>
                </div>
                <span className="card-index">03</span>
              </div>
              <label className="amount-label">
                Amount
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="$ 0.00"
                  aria-describedby="amount-help"
                />
              </label>
              <p id="amount-help" className="helper-text">
                Enter an amount in dollars. Deposits have no daily limit.
              </p>
              <div className="transaction-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !amount}
                  onClick={() => submitTransaction('deposit')}
                >
                  {busy ? 'Working…' : 'Deposit'}
                  <span aria-hidden="true">＋</span>
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !amount}
                  onClick={() => submitTransaction('withdraw')}
                >
                  Withdraw<span aria-hidden="true">−</span>
                </button>
              </div>
            </section>
            <section className="panel details-panel" aria-labelledby="details-title">
              <p className="eyebrow">Account details</p>
              <h2 id="details-title">Your Dena profile</h2>
              <dl>
                <div>
                  <dt>Name</dt>
                  <dd>{account.fullName}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{account.email}</dd>
                </div>
                <div>
                  <dt>Daily withdrawals</dt>
                  <dd>{formatCurrency(account.withdrawnTodayCents)} used</dd>
                </div>
              </dl>
              <p className="details-footnote">
                <span className="secure-dot" aria-hidden="true" />
                Your account is held in a private session.
              </p>
            </section>
          </div>
        </section>
      )}
      <footer className="footer">
        <span>© 2026 Dena Bank</span>
        <span>Built for clarity</span>
      </footer>
    </main>
  )
}

export default App

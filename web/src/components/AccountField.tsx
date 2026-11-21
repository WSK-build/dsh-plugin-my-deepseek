import { useEffect, useState } from 'react'
import {
  accountState,
  hasAccountBridge,
  onAccountState,
  restoreAccountSession,
  signOutAccount,
  startAccountLogin,
  type AccountState,
} from '../shared/account.js'
import { useTranslate } from '../../../vendor/chat-demo-src/i18n/index.js'
import { useSettings } from '../../../vendor/chat-demo-src/services/settings.js'
import { Button } from '../../../vendor/chat-demo-src/components/base/Button.js'
import clsx from 'clsx'
import styles from '../../../vendor/chat-demo-src/components/settings/Settings.module.css'

/**
 * 账号登录行，仅在存在原生桥时渲染。
 *
 * 登录后的请求以 `x-dsh-auth-token` 计费到账号余额，无需 API Key。
 * 布局复用设置面板的 `.cell`/`.row`/`.text`/`.label`/`.description`。
 */
export const AccountField = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const [state, setState] = useState<AccountState>(accountState)

  useEffect(() => {
    void restoreAccountSession()
    return onAccountState(setState)
  }, [])

  if (!hasAccountBridge()) {
    return null
  }

  const busy = state.phase === 'initializing' || state.phase === 'waiting-browser' || state.phase === 'exchanging'
  const status =
    state.phase === 'initializing'
      ? t('accountSigningIn')
      : state.phase === 'waiting-browser'
        ? t('accountWaitingBrowser')
        : state.phase === 'exchanging'
          ? t('accountExchanging')
          : null

  return (
    <div className={clsx(styles.cell, styles.row)}>
      <div className={styles.text}>
        <div className={styles.label}>{t(state.phase === 'signed-in' ? 'accountSignedIn' : 'accountSignIn')}</div>
        <div className={clsx(styles.description, (state.phase === 'failed' || state.phase === 'expired') && styles.error)}>
          {state.phase === 'failed' && state.error
            ? t('accountSignInFailed', { message: state.error })
            : state.phase === 'expired'
              ? t('accountExpired')
              : status ?? t(state.phase === 'signed-in' ? 'accountSignedInNote' : 'accountSignInNote')}
        </div>
      </div>
      {state.phase === 'signed-in' ? (
        <Button variant="outlined" size="m" className={styles.cellButton} onClick={() => void signOutAccount()}>
          {t('accountSignOut')}
        </Button>
      ) : (
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={busy}
          onClick={() => startAccountLogin(locale === 'en-US' ? 'en_US' : 'zh_CN')}
        >
          {t('accountSignInAction')}
        </Button>
      )}
    </div>
  )
}

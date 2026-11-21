/**
 * 设置页底部的版本行：「My DeepSeek v0.1.1 [检查更新]」。
 *
 * 与其它设置行同一套结构（Settings.module.css 的 cell / row / text / label /
 * description + 同规格按钮），因此不需要新增样式。
 * 检查只在用户点击时发起，见 web/src/shared/update-check.ts。
 */
import { useState } from 'react'
import { Button } from '../../../vendor/chat-demo-src/components/base/Button.js'
import { useTranslate } from '../../../vendor/chat-demo-src/i18n/index.js'
import clsx from 'clsx'
import styles from '../../../vendor/chat-demo-src/components/settings/Settings.module.css'
import {
  RELEASE_URL,
  checkForUpdate,
  currentTarget,
  currentVersion,
  type UpdateResult,
} from '../shared/update-check.js'

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; latest: string }
  | { kind: 'failed' }

export const VersionRow = () => {
  const t = useTranslate()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const check = async () => {
    setStatus({ kind: 'checking' })
    const result: UpdateResult = await checkForUpdate()
    if (!result.ok) {
      setStatus({ kind: 'failed' })
      return
    }
    setStatus(result.hasUpdate ? { kind: 'available', latest: result.latest } : { kind: 'latest' })
  }

  const checking = status.kind === 'checking'

  // 只有原生壳能跳浏览器；插件面板与体验站只提示有更新。
  const downloadLink = status.kind === 'available' && currentTarget() === 'native'

  return (
    <div className={clsx(styles.cell, styles.row)}>
      <div className={styles.text}>
        <div className={styles.label}>My DeepSeek</div>
        <div className={clsx(styles.description, status.kind === 'failed' && styles.error)}>
          {status.kind === 'checking' && t('updateChecking')}
          {status.kind === 'latest' && t('updateLatest')}
          {status.kind === 'failed' && t('updateFailed')}
          {status.kind === 'available' &&
            (downloadLink ? (
              <>
                {t('updateAvailable', { version: status.latest })}
                {' · '}
                <a
                  className={styles.descriptionLink}
                  href={RELEASE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('updateGoDownload')}
                </a>
              </>
            ) : (
              t('updateAvailable', { version: status.latest })
            ))}
          {status.kind === 'idle' && `v${currentVersion()}`}
        </div>
      </div>
      <Button
        variant="outlined"
        size="m"
        className={styles.cellButton}
        disabled={checking}
        onClick={() => void check()}
      >
        {checking ? t('updateCheckingAction') : t('updateCheckAction')}
      </Button>
    </div>
  )
}

import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'
import { accountState } from '../../../../web/src/shared/account.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有可用鉴权时打开设置并选中「数据管理」；账号登录与 API Key 任一可用即视为可用 */
export const ensureApiKey = () => {
  if (useSettings.getState().apiKey) {
    return true
  }
  if (accountState().phase === 'signed-in') {
    return true
  }
  openSettings('data')
  return false
}

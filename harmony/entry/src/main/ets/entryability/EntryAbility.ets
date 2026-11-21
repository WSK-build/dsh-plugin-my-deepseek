import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit'
import { hilog } from '@kit.PerformanceAnalysisKit'
import { window } from '@kit.ArkUI'

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'my-deepseek', 'Ability onCreate')
  }

  onDestroy(): void {
    hilog.info(0x0000, 'my-deepseek', 'Ability onDestroy')
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(0x0000, 'my-deepseek', 'Failed to load content: %{public}s', JSON.stringify(err))
        return
      }
      hilog.info(0x0000, 'my-deepseek', 'Content loaded')
    })
  }

  onWindowStageDestroy(): void {
    hilog.info(0x0000, 'my-deepseek', 'WindowStageDestroy')
  }

  onForeground(): void {
    hilog.info(0x0000, 'my-deepseek', 'Ability onForeground')
  }

  onBackground(): void {
    hilog.info(0x0000, 'my-deepseek', 'Ability onBackground')
  }
}

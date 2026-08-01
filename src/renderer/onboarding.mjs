export const ONBOARDING_KEY = 'seedstream.onboarding.completed.v1'

export function shouldShowOnboarding (storage) {
  try {
    return storage?.getItem(ONBOARDING_KEY) !== '1'
  } catch {
    return true
  }
}

export function completeOnboarding (storage) {
  try {
    storage?.setItem(ONBOARDING_KEY, '1')
  } catch {}
}

export function guideForPlatform (platform) {
  if (platform === 'darwin') {
    return {
      label: 'macOS',
      launch: '首次安装：把 SeedStream 拖入“应用程序”，然后右键应用选择“打开”。',
      warning: '若仍被拦截，请到“系统设置 → 隐私与安全”确认“仍要打开”。不要关闭系统安全保护。'
    }
  }
  if (platform === 'win32') {
    return {
      label: 'Windows',
      launch: '安装版：确认一次 UAC 后自动安装并启动；便携版：双击即可使用，无需安装。',
      warning: '若 SmartScreen 提示未知发布者，请先核对下载来源和 SHA-256，再选择“更多信息 → 仍要运行”。'
    }
  }
  return {
    label: '当前系统',
    launch: '从可信来源取得应用后，按系统安装提示完成首次打开。',
    warning: '遇到安全提示时先确认文件来源和校验值，不要关闭操作系统的安全功能。'
  }
}

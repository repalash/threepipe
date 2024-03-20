export interface IDialogWrapper {
    alert: (message?: string) => Promise<void>
    prompt: (message?: string, _default?: string, cancel?: boolean) => Promise<string | null>
    confirm: (message?: string) => Promise<boolean>
    confirmSync: (message?: string) => boolean
}
export const windowDialogWrapper: IDialogWrapper = {
    alert: async(message?: string) => window.alert(message),
    prompt: async(message?: string, _default?: string, _?: boolean) => window.prompt(message, _default),
    confirm: async(message?: string) => window.confirm(message),
    confirmSync: (message?: string) => window.confirm(message),
}

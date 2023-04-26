export interface IDialogWrapper {
    alert: (message?: string) => Promise<void>
    confirm: (message?: string) => Promise<boolean>
    prompt: (message?: string, _default?: string, cancel?: boolean) => Promise<string | null>
}
export const windowDialogWrapper: IDialogWrapper = {
    alert: async(message?: string) => window.alert(message),
    confirm: async(message?: string) => window.confirm(message),
    prompt: async(message?: string, _default?: string, _?: boolean) => window.prompt(message, _default),
}

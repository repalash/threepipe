// eslint-disable-next-line @typescript-eslint/naming-convention
export function _testFinish(): void {
    window.dispatchEvent(new Event('threepipe-test-finished'))
}
// eslint-disable-next-line @typescript-eslint/naming-convention
export function _testStart(): void {
    window.dispatchEvent(new Event('threepipe-test-started'))
}

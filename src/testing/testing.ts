// eslint-disable-next-line @typescript-eslint/naming-convention
export function _testFinish(): void {
    window.dispatchEvent(new Event('threepipe-test-finished'))
    document.body.classList.add('_testFinish')
}
// eslint-disable-next-line @typescript-eslint/naming-convention
export function _testStart(): void {
    window.dispatchEvent(new Event('threepipe-test-started'))
    document.body.classList.add('_testStarted')
}

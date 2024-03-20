export function createSimpleButtons(buttons: Record<string, (btn: HTMLButtonElement) => void>, container = document.body) {
    const entries = Object.entries(buttons)
    entries.forEach(([text, onclick], i) => {
        const btn = document.createElement('button')
        btn.innerText = text
        btn.style.position = 'absolute'
        btn.style.bottom = `${3 + (entries.length - i - 1) * 2}rem`
        btn.style.right = '3rem'
        btn.style.zIndex = '10000'
        btn.onclick = async() => onclick(btn)
        container.appendChild(btn)
    })
}

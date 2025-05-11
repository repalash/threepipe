function run () {
    if (document.body.classList.contains('_testStarted')) return
    const div = document.createElement('div');
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    Object.assign(div.style, {
        position: 'fixed', top: 0, left: 0, bottom: 0, right: 0, width: 'auto', height: 'max-content',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
        background: 'transparent', pointerEvents: 'none',
        zIndex: '49', // loading screen is 50
        transition: 'opacity 0.5s ease',
        color: colorScheme !== 'dark' ? '#eee' : '#222',
        fontSize: '1.25rem',
        margin: 'auto',
    });
    div.innerHTML = '<div style="width:32px;height:32px;border:4px solid #ccc;border-top:4px solid #333;border-radius:50%;animation:spin 1s linear infinite;margin:auto"></div><div style="text-align:center;margin-top:8px;font-family:sans-serif">Loading...</div><style>@keyframes spin{100%{transform:rotate(360deg)}}</style>';
    document.body.appendChild(div);
    let removed = false

    function remove () {
        if (removed) return
        removed = true
        div.style.opacity = '0';
        setTimeout(() => div.remove(), 600);
    }

    window.addEventListener('threepipe-test-started', remove)
    setTimeout(remove, 8000); // remove after 5 seconds if not removed
}
run()

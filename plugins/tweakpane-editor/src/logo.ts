import {createDiv, getUrlQueryParam, ThreeViewer} from 'threepipe'
import tippy from 'tippy.js'

export function setupWebGiLogo(viewer: ThreeViewer) {
    const webgiLogo = createDiv({
        innerHTML: '',
        id: 'webgi-logo',
        addToBody: false,
    })
    if (getUrlQueryParam('logo-img')) {
        webgiLogo.style.backgroundImage = `url(${getUrlQueryParam('logo-img')})`
    }
    webgiLogo.onclick = () => {
        window.open(getUrlQueryParam('logo-link') || 'https://webgi.dev', '_blank')
    }
    viewer.container.appendChild(webgiLogo)
    tippy(webgiLogo, {
        placement: 'right',
        content: 'Powered by Threepipe SDK',
    })
}

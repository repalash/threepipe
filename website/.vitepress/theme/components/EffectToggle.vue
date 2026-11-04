<!-- On/off switch for the plugin sections of package/webgi-plugins (ported from the webgi.dev home page). -->
<!-- The page script finds it by the id given to the component and listens to the checkbox. -->
<template>
  <div class="switch">
    <label aria-label="Toggle Filter">
      <input type="checkbox" data-on="ON" data-off="OFF">
    </label>
    <span class="led"></span>
  </div>
</template>

<style>
/* not scoped: the name is referenced through a custom property, which scoped keyframe renaming does not follow */
@keyframes checkbox-toggle-led{
  0%,10%,20%,30%,40%,50%,60%,70%,80%{
    background-color: var(--led-color-off);
  }
  5%,15%,25%,35%,45%,55%,65%,75%,85%{
    background-color: var(--led-color-loading);
  }
  100%{
    background-color: var(--led-color-on);
  }
}
</style>
<style scoped>
.switch{
  --switch-width: 80px;
  --switch-height: calc(var(--switch-width) / 2);
  --switch-border-radius: 999vw; /* this will also adjust the radius on the toggle */
  --switch-clr-border: rgba(255 255 255 / .25);
  --switch-clr-bg: rgb(41 37 36);
  --switch-clr-bg-on: green;
  --switch-clr-txt: white;
  --switch-inset: 2px;
  --switch-duration: 300ms;

  --toggle-size: calc(var(--switch-height) - var(--switch-inset) * 3);
  --toggle-gap: calc(var(--toggle-size) * 1.5);
  --toggle-bg: #404040;
  --toggle-bg-on: #F3F4F6;

  --led-size: 8px;
  --led-color-off: rgba(255 255 255 / .15);
  --led-color-on: rgb(56, 189, 248);
  --led-color-loading: rgb(234 179 8);
  --led-duration: 0s;
  --led-delay: 200ms;
  --led-blur: 12px;
  --led-blur-distance: -.5rem;

  display: inline-flex;
  align-items: center;
  gap: .75rem;
  width: fit-content;
}

.switch label{
  position: relative;
  cursor: pointer;
  overflow: hidden;
  width: var(--switch-width);
  height: var(--switch-height);
  border-radius: var(--switch-border-radius);
  border: 1px solid var(--switch-clr-border);
  outline: 1px dashed transparent;
  outline-offset: 4px;
  color: var(--switch-clr-txt);
  background-color: var(--switch-clr-bg);
  isolation: isolate;
  transition-property: background-color;
  transition-duration: var(--switch-duration);
  transition-timing-function: ease-in-out;
  transition-delay: var(--switch-delay,0ms);
}

.switch input[type="checkbox"] {
  position: absolute;
  pointer-events: none;
  appearance: none;
  border: none;
  outline: none;
  border-radius: inherit;
  background-color: var(--toggle-bg);
  top: var(--switch-inset);
  left: var(--toggle-x,var(--switch-inset));
  width: var(--toggle-size);
  height: var(--toggle-size);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--toggle-gap);

  transition-property: left, background-color;
  transition-duration: var(--switch-duration);
  transition-timing-function: ease-in-out;
}
.switch input[type="checkbox"]::before,
.switch input[type="checkbox"]::after{
  position: relative;
  color: white;
  transition: scale var(--switch-duration);
}
.switch input[type="checkbox"]::before{
  content: attr(data-on);
  scale: var(--label-scale-on, .75);
}
.switch input[type="checkbox"]::after{
  content: attr(data-off);
  scale: var(--label-scale-off, 1);
}

.switch > .led{
  position: relative;
  width: var(--led-size);
  height: var(--led-size);
  display: block;
  border: 1px solid rgba(255 255 255 / .25);
  border-radius: 50%;
  background-color: var(--led-color-off) ;
  transition: background-color 50ms;
  animation: var(--led-animation,"")
}
.switch > .led:before{
  content: '';
  position: absolute;
  inset: var(--led-blur-distance);
  z-index: -1;
  border-radius: inherit;
  filter: blur(var(--led-blur));
  opacity: .75;
  animation: var(--led-animation,"")
}
.switch:has(input[type="checkbox"]:focus-visible) label{
  outline-color: white;
}
/* switch "on" */
.switch:has(input[type="checkbox"]:checked){
  --switch-clr-bg: var(--switch-clr-bg-on);
  --switch-delay: 250ms; /* slight delay on background color change */
  --toggle-x: calc(50% + var(--switch-inset));
  --toggle-bg: var(--toggle-bg-on);
  --led-animation: checkbox-toggle-led var(--led-duration) linear forwards var(--led-delay);
  --label-scale-off: .75;
  --label-scale-on: 1;
}

*,
::before,
::after {
  box-sizing: border-box;
}
input{
  margin: 0;
  padding: 0;
}
</style>

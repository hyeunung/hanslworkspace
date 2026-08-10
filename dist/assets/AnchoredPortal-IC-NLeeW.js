import{c as e,r as t,ao as n,j as r}from"./index-DClIh3NT.js";
/**
 * @license lucide-react v0.541.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i=e("rotate-ccw",[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]);function o({anchorEl:e,children:i,align:o="left",gap:s=2,zIndex:a=9999}){const c=t.useRef(null),[d,l]=t.useState(null);return t.useLayoutEffect(()=>{if(!e)return;const t=()=>{const t=e.getBoundingClientRect(),n=c.current?.offsetWidth??0,r=c.current?.offsetHeight??0;let i="right"===o?t.right-n:t.left,a=t.bottom+s;i+n>window.innerWidth-8&&(i=window.innerWidth-8-n),i<8&&(i=8),a+r>window.innerHeight-8&&(a=Math.max(8,t.top-s-r)),l({left:i,top:a})};t();const n=requestAnimationFrame(t),r=c.current?new ResizeObserver(t):null;return c.current&&r?.observe(c.current),window.addEventListener("scroll",t,!0),window.addEventListener("resize",t),()=>{cancelAnimationFrame(n),r?.disconnect(),window.removeEventListener("scroll",t,!0),window.removeEventListener("resize",t)}},[e,o,s]),e?n.createPortal(r.jsx("div",{ref:c,style:{position:"fixed",left:d?.left??-9999,top:d?.top??-9999,zIndex:a},children:i}),document.body):null}export{o as A,i as R};
//# sourceMappingURL=AnchoredPortal-IC-NLeeW.js.map

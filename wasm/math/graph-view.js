export function drawGraph(canvas, values) {
        const ctx = canvas.getContext('2d'),theme=getComputedStyle(document.documentElement);
        ctx.fillStyle=theme.getPropertyValue('--silas-graph-bg').trim();ctx.fillRect(0,0,720,480);
        ctx.lineWidth=1; ctx.strokeStyle=theme.getPropertyValue('--silas-graph-grid').trim();
        for(let i=0;i<=20;i++){ctx.beginPath();ctx.moveTo(i*36,0);ctx.lineTo(i*36,480);ctx.moveTo(0,i*24);ctx.lineTo(720,i*24);ctx.stroke();}
        ctx.strokeStyle=theme.getPropertyValue('--silas-graph-axes').trim();ctx.beginPath();ctx.moveTo(360,0);ctx.lineTo(360,480);ctx.moveTo(0,240);ctx.lineTo(720,240);ctx.stroke();
        ctx.fillStyle=theme.getPropertyValue('--silas-graph-axes').trim();ctx.font='12px "JetBrains Mono", monospace';for(let n=-10;n<=10;n+=2){if(n){ctx.fillText(String(n),360+n*36+2,254);ctx.fillText(String(n),364,240-n*24-3);}}
        ctx.strokeStyle=theme.getPropertyValue('--silas-graph-line').trim();ctx.lineWidth=2;ctx.beginPath();let previous=null;
        values.forEach((v,i)=>{const y=240-v.value*24;if(v.kind!=='finite'||!Number.isFinite(y)||Math.abs(v.value)>10){previous=null;return;}if(previous!==null&&Math.abs(y-previous)<120)ctx.lineTo(i,y);else ctx.moveTo(i,y);previous=y;});ctx.stroke();
}

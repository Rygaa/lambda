(()=>{var f=document.querySelector("#theme-toggle");f?.addEventListener("click",c=>{c.preventDefault();let e="light",t=localStorage.getItem("theme");t==="light"||t==="dark"?e=t:matchMedia("(prefers-color-scheme: dark)").matches&&(e="dark"),e=e==="light"?"dark":"light",localStorage.setItem("theme",e),document.documentElement.classList.remove("light","dark"),document.documentElement.classList.add(e)});var h=class extends HTMLElement{fetch_url="";observer;constructor(){super(),this.innerHTML="Loading conversation...";let e=new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread");e.searchParams.append("uri",this.attributes.post.value),e.searchParams.append("depth",2),this.fetch_url=e.href}connectedCallback(){this.observer=new IntersectionObserver((e,t)=>{e[0].isIntersecting&&(t.disconnect(),this.render())}),this.observer.observe(this)}disconnectedCallback(){this.observer.disconnect()}async render(){let e;try{let p=await fetch(this.fetch_url,{method:"GET",headers:{Accept:"application/json"},cach:"no-store"});if(!p.ok)throw new Error("ouch!");e=(await p.json()).thread}catch{this.innerHTML="<p>Failed loading Bluesky thread :(</p>";return}let{post:t}=e,l=this.bsky_page_from_uri(t.uri),{likeCount:s,repostCount:r,replyCount:a}=t,n=`\u2764\uFE0F ${s} ${s===1?"like":"likes"} \u267B\uFE0F ${r} ${r===1?"repost":"reposts"} \u{1F4AC} ${a} ${a===1?"reply":"replies"}`,d=`
      <div class="flex-col" style="gap: var(--space-m)">
        <div>
          <a href="${l}" target="_blank" style="color: var(--text-1)">${n}</a>
        </div>
        <div>
          <a href="${l}" target="_blank" class="bsky-reply-btn">\u{1F98B} Reply on Bluesky</a>
        </div>
        ${this.render_replies(e.post,e.replies??[],20)}
        ${e.replies?.length?"":"<p>No replies yet...</p>"}
      </div>
    `;this.innerHTML=d}render_post(e,t,l){let s="",{author:r}=e,a="";return t.length>0&&(a='<div style="width: 2px; height: calc(100% - 56px); background: var(--text-3); margin-left: 15px; margin-top: 8px;"></div>'),s+=`
      <li stylewrong="display: flex; gap: var(--space-2xs)" class="flex" style="--flow-space: var(--space-2xs)">
        <div style="flex: none">
          <a href="https://bsky.app/profile/${r.did}" target="_blank">
            <img src="${r.avatar??""}" width="32" height="32" loading="lazy" style="border-radius: 99999px">
          </a>
          ${a}
        </div>
        <div>
          <a href="https://bsky.app/profile/${r.did}" target="_blank">
            <span style="color: var(--text-1)">${r.displayName}</span>
            <span style="color: var(--text-2)">${r.handle}</span>
          </a>
          <span style="font-size: var(--step--2)">&middot; ${y(new Date,new Date(e.record.createdAt))}</span>
          <div class="flow">
            <div>${u(e.record.text)}</div>
            <a href="${this.bsky_page_from_uri(e.uri)}" target="_blank" class="bsky-reply-stats-btn">
              \u{1F4AC} ${e.replyCount} \u267B\uFE0F ${e.repostCount} \u2764\uFE0F ${e.likeCount}
            </a>
            ${this.render_replies(e,t,l)}
          </div>
        </div>
      </li>
    `,s}render_replies(e,t,l){let s="",r=t.sort((a,n)=>n.post.likeCount-a.post.likeCount||n.post.record.createdAt.localeCompare(a.post.record.createdAt)).slice(0,l);if(r.length>0){s='<ul class="flex-col" style="--flow-space: var(--space-xs); list-style-type: none; padding: 0; font-size: var(--step--1)">';for(let a of r)s+=this.render_post(a.post,a.replies??[],2);t.length>l&&(s+=`
          <li>
            <a href="${this.bsky_page_from_uri(e.uri)}" target="_blank" style="color: var(--text-2)">
              See more replies on <span style="color: var(--bsky-blue)">Bluesky</span>
            </a>
          </li>
        `),s+="</ul>"}return s}bsky_page_from_uri(e){return e.replace("at://","https://bsky.app/profile/").replace("/app.bsky.feed.post/","/post/")}};customElements.define("bsky-thread",h);function u(c){return c.replace(/[&<>"']/g,e=>`&#${e.charCodeAt(0)};`)}function y(c,e){let t=c.getTime()-e.getTime(),l=t/1e3,s=t/6e4,r=t/36e5,a=t/864e5,n=t/6048e5,d=t/2628e6,p=t/31536e6,i="seconds",o=l;return p>=1?(i="years",o=p):d>=1?(i="months",o=d):n>=1?(i="weeks",o=n):a>=1?(i="days",o=a):r>=1?(i="hours",o=r):s>=1&&(i="minutes",o=s),m.format(-o.toFixed(0),i)}var m=new Intl.RelativeTimeFormat(void 0,{style:"narrow"});})();

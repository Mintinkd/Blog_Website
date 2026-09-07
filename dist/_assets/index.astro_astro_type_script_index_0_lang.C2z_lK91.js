import{t as n,g as f}from"./i18n.Bppg9S7s.js";import{g as w,c as L,a as _,s as m}from"./categoryColors.C23KiAO5.js";async function p(e=1){const o=document.querySelector(".article-list-inner");if(!o)return;const u=f()==="zh"?"zh-CN":"en-US";try{const r=await(await fetch(`/api/v1/articles?page=${e}&status=published`)).json();if(r.code===0&&r.data){const{items:g,total:E,total_pages:l}=r.data;if(g.length===0){o.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("article.no_articles")}</p>`;return}const i=document.documentElement.getAttribute("data-theme")==="dark",$=a=>String(a||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");o.innerHTML=g.map(a=>{const t=a.category,s=w(t?.slug,t?.name),c=t?L(s,i):null,y=c?`style="background:${c.background};color:${c.color};border:${c.border};"`:"",h=a.cover_image?`<div class="list-card-cover"><img src="${$(a.cover_image)}" alt="" loading="lazy" /></div>`:`<div class="list-card-cover list-card-cover-grad" style="background:${_(s,i)};"><span class="list-cover-cat-name" style="color:${i?m(s,40):m(s,-28)};">${t?.name||"✦"}</span></div>`;return`
          <article class="list-card" data-reveal="fade-up">
            <a href="/articles/${a.slug}" class="list-card-link">
              ${h}
              <div class="list-card-body">
                <div class="list-card-meta">
                  ${t?`<span class="list-card-category" ${y}>${t.name}</span>`:""}
                  <span class="list-card-date">${a.published_at?new Date(a.published_at).toLocaleDateString(u,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="list-card-title">${a.title}</h3>
                ${a.summary?`<p class="list-card-summary">${a.summary}</p>`:""}
                <div class="list-card-footer">
                  <div class="list-card-tags">
                    ${(a.tags||[]).slice(0,3).map(b=>`<span class="list-card-tag">${b.name}</span>`).join("")}
                  </div>
                  <span class="list-card-stats">${a.view_count||0} ${n("article.read")}</span>
                </div>
              </div>
            </a>
          </article>`}).join(""),window.dispatchEvent(new CustomEvent("motion:refresh"));const d=document.getElementById("pagination-mount");if(d&&l>1){let a='<div class="pagination">';e>1&&(a+=`<button class="pag-btn" data-page="${e-1}">${n("page.prev")}</button>`),a+=`<span class="pag-info">${e} / ${l}</span>`,e<l&&(a+=`<button class="pag-btn" data-page="${e+1}">${n("page.next")}</button>`),a+="</div>",d.innerHTML=a,d.querySelectorAll(".pag-btn").forEach(t=>{t.addEventListener("click",()=>{const s=parseInt(t.dataset.page||"1",10);p(s),window.scrollTo({top:0,behavior:"smooth"})})})}}}catch{o.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("article.load_error")}</p>`}}p();document.addEventListener("locale-changed",()=>p());

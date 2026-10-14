import{t as n,g as h}from"./i18n.Bppg9S7s.js";import{g as f,c as b,a as L,b as w}from"./categoryColors.B-OBBTpf.js";import{b as _,e as r,s as E}from"./escape.DHLiVI85.js";import"./purify.es.Csrj9YNg.js";async function d(s=1){const o=document.querySelector(".article-list-inner");if(!o)return;const g=h()==="zh"?"zh-CN":"en-US";try{const c=await(await fetch(`/api/v1/articles?page=${s}&status=published`)).json();if(c.code===0&&c.data){const{items:p,total:x,total_pages:i}=c.data;if(p.length===0){o.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("article.no_articles")}</p>`;return}const v=_;o.innerHTML=p.map(a=>{const t=a.category,e=f(t?.slug,t?.name),u=t?b(e):"",$=a.cover_image?`<div class="list-card-cover"><img src="${v(a.cover_image)}" alt="" loading="lazy" /></div>`:`<div class="list-card-cover list-card-cover-grad" style="${L(e)}"><span class="list-cover-cat-name" style="${w(e)}">${r(t?.name||"✦")}</span></div>`;return`
          <article class="list-card" data-reveal="fade-up">
            <a href="/articles/${E(a.slug)}" class="list-card-link">
              ${$}
              <div class="list-card-body">
                <div class="list-card-meta">
                  ${t?`<span class="list-card-category" style="${u}">${r(t.name)}</span>`:""}
                  <span class="list-card-date">${a.published_at?new Date(a.published_at).toLocaleDateString(g,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="list-card-title">${r(a.title)}</h3>
                ${a.summary?`<p class="list-card-summary">${r(a.summary)}</p>`:""}
                <div class="list-card-footer">
                  <div class="list-card-tags">
                    ${(a.tags||[]).slice(0,3).map(y=>`<span class="list-card-tag">${r(y.name)}</span>`).join("")}
                  </div>
                  <span class="list-card-stats">${a.view_count||0} ${n("article.read")}</span>
                </div>
              </div>
            </a>
          </article>`}).join(""),window.dispatchEvent(new CustomEvent("motion:refresh"));const l=document.getElementById("pagination-mount");if(l&&i>1){let a='<div class="pagination">';s>1&&(a+=`<button class="pag-btn" data-page="${s-1}">${n("page.prev")}</button>`),a+=`<span class="pag-info">${s} / ${i}</span>`,s<i&&(a+=`<button class="pag-btn" data-page="${s+1}">${n("page.next")}</button>`),a+="</div>",l.innerHTML=a,l.querySelectorAll(".pag-btn").forEach(t=>{t.addEventListener("click",()=>{const e=parseInt(t.dataset.page||"1",10);d(e),window.scrollTo({top:0,behavior:"smooth"})})})}}}catch{o.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("article.load_error")}</p>`}}document.addEventListener("astro:page-load",()=>d());document.addEventListener("locale-changed",()=>d());

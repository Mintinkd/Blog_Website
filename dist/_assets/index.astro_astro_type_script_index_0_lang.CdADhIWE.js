import{t as n,g as $}from"./i18n.Bppg9S7s.js";import{g as h,c as b,a as f,s as l}from"./categoryColors.C23KiAO5.js";async function i(){const t=document.getElementById("article-grid");if(!t)return;const g=$()==="zh"?"zh-CN":"en-US";try{const s=await(await fetch("/api/v1/articles?page=1&page_size=6&status=published")).json();if(s.code===0&&s.data){const{items:d}=s.data;if(d.length===0){t.innerHTML=`<p class="empty-text" style="grid-column:1/-1;text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("article.no_articles")}</p>`;return}const o=document.documentElement.getAttribute("data-theme")==="dark",m=a=>String(a||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");t.innerHTML=d.map(a=>{const e=a.category,c=h(e?.slug,e?.name),r=e?b(c,o):null,u=r?`style="background:${r.background};color:${r.color};border:${r.border};"`:"",v=a.cover_image?`<div class="card-cover"><img src="${m(a.cover_image)}" alt="" loading="lazy" /></div>`:`<div class="card-cover card-cover-grad" style="background:${f(c,o)};"><span class="cover-cat-name" style="color:${o?l(c,40):l(c,-28)};">${e?.name||"✦"}</span></div>`;return`
          <article class="article-card" data-reveal="fade-up">
            <a href="/articles/${a.slug}" class="card-link">
              ${v}
              <div class="card-body">
                <div class="card-meta">
                  ${e?`<span class="card-category" ${u}>${e.name}</span>`:""}
                  <span class="card-date">${a.published_at?new Date(a.published_at).toLocaleDateString(g,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="card-title">${a.title}</h3>
                <p class="card-summary">${a.summary||""}</p>
                <div class="card-footer">
                  <div class="card-tags">
                    ${(a.tags||[]).slice(0,2).map(y=>`<span class="card-tag">${y.name}</span>`).join("")}
                  </div>
                  <span class="card-read">${a.view_count||0} ${n("article.read")}</span>
                </div>
              </div>
            </a>
          </article>`}).join(""),window.dispatchEvent(new CustomEvent("motion:refresh"))}}catch{t.innerHTML=`<p class="error-text" style="grid-column:1/-1;text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("article.load_error")}</p>`}}i();document.addEventListener("locale-changed",()=>i());

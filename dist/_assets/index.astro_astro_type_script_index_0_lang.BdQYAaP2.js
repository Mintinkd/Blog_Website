import{t as n,g as y}from"./i18n.Bppg9S7s.js";import{g as h,c as f,a as b,b as w}from"./categoryColors.B-OBBTpf.js";async function i(s=1){const c=document.querySelector(".article-list-inner");if(!c)return;const p=y()==="zh"?"zh-CN":"en-US";try{const r=await(await fetch(`/api/v1/articles?page=${s}&status=published`)).json();if(r.code===0&&r.data){const{items:d,total:_,total_pages:o}=r.data;if(d.length===0){c.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("article.no_articles")}</p>`;return}const m=a=>String(a||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");c.innerHTML=d.map(a=>{const t=a.category,e=h(t?.slug,t?.name),v=t?f(e):"",u=a.cover_image?`<div class="list-card-cover"><img src="${m(a.cover_image)}" alt="" loading="lazy" /></div>`:`<div class="list-card-cover list-card-cover-grad" style="${b(e)}"><span class="list-cover-cat-name" style="${w(e)}">${t?.name||"✦"}</span></div>`;return`
          <article class="list-card" data-reveal="fade-up">
            <a href="/articles/${a.slug}" class="list-card-link">
              ${u}
              <div class="list-card-body">
                <div class="list-card-meta">
                  ${t?`<span class="list-card-category" style="${v}">${t.name}</span>`:""}
                  <span class="list-card-date">${a.published_at?new Date(a.published_at).toLocaleDateString(p,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="list-card-title">${a.title}</h3>
                ${a.summary?`<p class="list-card-summary">${a.summary}</p>`:""}
                <div class="list-card-footer">
                  <div class="list-card-tags">
                    ${(a.tags||[]).slice(0,3).map($=>`<span class="list-card-tag">${$.name}</span>`).join("")}
                  </div>
                  <span class="list-card-stats">${a.view_count||0} ${n("article.read")}</span>
                </div>
              </div>
            </a>
          </article>`}).join(""),window.dispatchEvent(new CustomEvent("motion:refresh"));const l=document.getElementById("pagination-mount");if(l&&o>1){let a='<div class="pagination">';s>1&&(a+=`<button class="pag-btn" data-page="${s-1}">${n("page.prev")}</button>`),a+=`<span class="pag-info">${s} / ${o}</span>`,s<o&&(a+=`<button class="pag-btn" data-page="${s+1}">${n("page.next")}</button>`),a+="</div>",l.innerHTML=a,l.querySelectorAll(".pag-btn").forEach(t=>{t.addEventListener("click",()=>{const e=parseInt(t.dataset.page||"1",10);i(e),window.scrollTo({top:0,behavior:"smooth"})})})}}}catch{c.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${n("article.load_error")}</p>`}}i();document.addEventListener("locale-changed",()=>i());

import{t as s,getLocale as m}from"./i18n.CQj9Tpoy.js";async function o(t=1){const e=document.querySelector(".article-list-inner");if(!e)return;const d=m()==="zh"?"zh-CN":"en-US";try{const c=await(await fetch(`/api/v1/articles?page=${t}&status=published`)).json();if(c.code===0&&c.data){const{items:r,total:$,total_pages:i}=c.data;if(r.length===0){e.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${s("article.no_articles")}</p>`;return}e.innerHTML=r.map(a=>`
          <article class="list-card">
            <a href="/articles/${a.slug}" class="list-card-link">
              <div class="list-card-body">
                <div class="list-card-meta">
                  ${a.category?`<span class="list-card-category">${a.category.name}</span>`:""}
                  <span class="list-card-date">${a.published_at?new Date(a.published_at).toLocaleDateString(d,{year:"numeric",month:"long",day:"numeric"}):""}</span>
                </div>
                <h3 class="list-card-title">${a.title}</h3>
                ${a.summary?`<p class="list-card-summary">${a.summary}</p>`:""}
                <div class="list-card-footer">
                  <div class="list-card-tags">
                    ${(a.tags||[]).slice(0,3).map(n=>`<span class="list-card-tag">${n.name}</span>`).join("")}
                  </div>
                  <span class="list-card-stats">${a.view_count||0} ${s("article.read")}</span>
                </div>
              </div>
            </a>
          </article>
        `).join("");const l=document.getElementById("pagination-mount");if(l&&i>1){let a='<div class="pagination">';t>1&&(a+=`<button class="pag-btn" data-page="${t-1}">${s("page.prev")}</button>`),a+=`<span class="pag-info">${t} / ${i}</span>`,t<i&&(a+=`<button class="pag-btn" data-page="${t+1}">${s("page.next")}</button>`),a+="</div>",l.innerHTML=a,l.querySelectorAll(".pag-btn").forEach(n=>{n.addEventListener("click",()=>{const g=parseInt(n.dataset.page||"1",10);o(g),window.scrollTo({top:0,behavior:"smooth"})})})}}}catch{e.innerHTML=`<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${s("article.load_error")}</p>`}}o();document.addEventListener("locale-changed",()=>o());

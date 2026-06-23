document.addEventListener("submit", (event) => {
  const form = event.target;
  const message = form.getAttribute("data-confirm");
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduceMotion) {
  const root = document.documentElement;
  const pointer = { x: 50, y: 18 };
  const targetPointer = { x: 50, y: 18 };
  let scrollY = window.scrollY;
  let scheduled = false;

  function updateAmbientBackground() {
    scheduled = false;
    pointer.x += (targetPointer.x - pointer.x) * 0.08;
    pointer.y += (targetPointer.y - pointer.y) * 0.08;
    const shift = Math.max(-120, Math.min(160, scrollY * 0.08));
    root.style.setProperty("--pointer-x", `${pointer.x}%`);
    root.style.setProperty("--pointer-y", `${pointer.y}%`);
    root.style.setProperty("--scroll-shift", `${shift}px`);
    root.style.setProperty("--glow-rotate", `${scrollY * 0.018}deg`);
    root.style.setProperty("--glow-drift-x", `${(pointer.x - 50) * 0.9}px`);
    root.style.setProperty("--glow-drift-y", `${(pointer.y - 50) * 0.7}px`);
    if (Math.abs(targetPointer.x - pointer.x) > 0.08 || Math.abs(targetPointer.y - pointer.y) > 0.08) {
      scheduleAmbientUpdate();
    }
  }

  function scheduleAmbientUpdate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateAmbientBackground);
  }

  window.addEventListener("pointermove", (event) => {
    targetPointer.x = 42 + ((event.clientX / window.innerWidth) - 0.5) * 22;
    targetPointer.y = 24 + ((event.clientY / window.innerHeight) - 0.5) * 18;
    scheduleAmbientUpdate();
  }, { passive: true });

  window.addEventListener("scroll", () => {
    scrollY = window.scrollY;
    scheduleAmbientUpdate();
  }, { passive: true });

  updateAmbientBackground();
}

const feed = document.querySelector("[data-feed]");
const sentinel = document.querySelector("[data-feed-sentinel]");

if (feed && sentinel) {
  let loading = false;

  async function loadMoreArticles() {
    if (loading || feed.dataset.hasMore !== "true") return;
    loading = true;
    sentinel.textContent = "加载中...";

    try {
      const offset = Number.parseInt(feed.dataset.nextOffset || "0", 10);
      const limit = Number.parseInt(feed.dataset.pageSize || "12", 10);
      const response = await fetch(`/api/articles?offset=${offset}&limit=${limit}`, {
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error("Failed to load articles.");

      const result = await response.json();
      feed.insertAdjacentHTML("beforeend", result.html);
      feed.dataset.nextOffset = String(result.nextOffset);
      feed.dataset.hasMore = result.hasMore ? "true" : "false";
      sentinel.textContent = result.hasMore ? "继续向下滚动" : "已经到底了";
    } catch {
      sentinel.textContent = "加载失败，向下滚动重试";
    } finally {
      loading = false;
    }
  }

  if (feed.dataset.hasMore === "true" && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMoreArticles();
      }
    }, { rootMargin: "500px 0px" });
    observer.observe(sentinel);
  } else if (feed.dataset.hasMore !== "true") {
    sentinel.textContent = "已经到底了";
  }
}

const prose = document.querySelector(".prose");

if (prose) {
  const lightbox = document.createElement("div");
  lightbox.className = "image-lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Image preview");
  lightbox.hidden = true;
  lightbox.innerHTML = `
    <button class="image-lightbox-close" type="button" aria-label="Close image">×</button>
    <img class="image-lightbox-img" alt="">
  `;
  document.body.append(lightbox);

  const lightboxImage = lightbox.querySelector(".image-lightbox-img");
  const closeButton = lightbox.querySelector(".image-lightbox-close");
  let lastFocusedElement = null;

  function openImageLightbox(image) {
    lastFocusedElement = document.activeElement;
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt || "";
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
    closeButton.focus();
  }

  function closeImageLightbox() {
    if (lightbox.hidden) return;
    lightbox.hidden = true;
    lightboxImage.removeAttribute("src");
    document.body.classList.remove("lightbox-open");
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  for (const image of prose.querySelectorAll("img")) {
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "Open image preview");
  }

  prose.addEventListener("click", (event) => {
    const image = event.target.closest(".prose img");
    if (image) openImageLightbox(image);
  });

  prose.addEventListener("keydown", (event) => {
    const image = event.target.closest(".prose img");
    if (!image || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openImageLightbox(image);
  });

  closeButton.addEventListener("click", closeImageLightbox);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closeImageLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeImageLightbox();
  });
}

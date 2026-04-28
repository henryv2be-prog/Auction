(function setupMediaSlider() {
  const slider = document.querySelector("[data-media-slider]");
  if (!slider) {
    return;
  }

  const track = slider.querySelector("[data-media-track]");
  const slides = Array.from(slider.querySelectorAll("[data-media-slide]"));
  const previousButton = slider.querySelector("[data-media-prev]");
  const nextButton = slider.querySelector("[data-media-next]");
  const dotsContainer = slider.querySelector(".carousel-dots");
  const lightbox = slider.querySelector("[data-media-overlay]");
  const lightboxBody = slider.querySelector(".media-modal-media");
  const lightboxCaption = slider.querySelector("[data-overlay-title]");
  const lightboxClose = slider.querySelector("[data-lightbox-close]");
  const lightboxPrev = slider.querySelector("[data-overlay-prev]");
  const lightboxNext = slider.querySelector("[data-overlay-next]");
  let currentIndex = 0;
  let lightboxIndex = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let isSwiping = false;
  const dots = [];

  if (!track || !slides.length) {
    return;
  }

  function setIndex(index) {
    currentIndex = Math.max(0, Math.min(index, slides.length - 1));
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    dots.forEach((dot, dotIndex) => {
      const active = dotIndex === currentIndex;
      dot.classList.toggle("active", active);
      dot.setAttribute("aria-selected", active ? "true" : "false");
      dot.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  function move(delta) {
    setIndex(currentIndex + delta);
  }

  function openLightbox(index) {
    if (!lightbox || !lightboxBody || !lightboxCaption) {
      return;
    }

    lightboxIndex = Math.max(0, Math.min(index, slides.length - 1));
    const slide = slides[lightboxIndex];
    const mediaType = slide.dataset.mediaType;
    const source = slide.dataset.mediaSrc;
    const name = slide.dataset.mediaTitle || "Media";

    lightboxBody.innerHTML = "";
    if (mediaType === "video") {
      const video = document.createElement("video");
      video.controls = true;
      video.autoplay = true;
      video.preload = "metadata";
      const sourceEl = document.createElement("source");
      sourceEl.src = source;
      video.appendChild(sourceEl);
      lightboxBody.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = source;
      img.alt = name;
      lightboxBody.appendChild(img);
    }

    lightboxCaption.textContent = `${lightboxIndex + 1} / ${slides.length} - ${name}`;
    lightbox.hidden = false;
    lightbox.classList.add("open");
    document.body.classList.add("overlay-open");
  }

  function closeLightbox() {
    if (!lightbox || !lightboxBody) {
      return;
    }

    const video = lightboxBody.querySelector("video");
    if (video) {
      video.pause();
    }
    lightboxBody.innerHTML = "";
    lightbox.hidden = true;
    lightbox.classList.remove("open");
    document.body.classList.remove("overlay-open");
  }

  function moveLightbox(delta) {
    if (!lightbox || lightbox.hidden) {
      return;
    }
    let nextIndex = lightboxIndex + delta;
    if (nextIndex < 0) {
      nextIndex = slides.length - 1;
    } else if (nextIndex >= slides.length) {
      nextIndex = 0;
    }
    openLightbox(nextIndex);
  }

  previousButton?.addEventListener("click", () => move(-1));
  nextButton?.addEventListener("click", () => move(1));

  if (dotsContainer && slides.length > 1) {
    slides.forEach((_, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "carousel-dot";
      dot.setAttribute("aria-label", `Go to slide ${index + 1}`);
      dot.addEventListener("click", () => setIndex(index));
      dotsContainer.appendChild(dot);
      dots.push(dot);
    });
  }

  slides.forEach((slide, index) => {
    slide.addEventListener("click", () => {
      if (!isSwiping) {
        openLightbox(index);
      }
    });
  });

  track.addEventListener(
    "touchstart",
    (event) => {
      if (!event.touches || !event.touches.length) {
        return;
      }
      isSwiping = false;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    },
    { passive: true }
  );

  track.addEventListener(
    "touchend",
    (event) => {
      if (!event.changedTouches || !event.changedTouches.length) {
        return;
      }
      const deltaX = event.changedTouches[0].clientX - touchStartX;
      const deltaY = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaX) < 40 || Math.abs(deltaX) < Math.abs(deltaY)) {
        return;
      }
      isSwiping = true;
      if (deltaX < 0) {
        move(1);
      } else {
        move(-1);
      }
    },
    { passive: true }
  );

  if (lightbox) {
    lightboxClose?.addEventListener("click", closeLightbox);
    lightboxPrev?.addEventListener("click", () => moveLightbox(-1));
    lightboxNext?.addEventListener("click", () => moveLightbox(1));
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) {
        closeLightbox();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (lightbox.hidden) {
        return;
      }
      if (event.key === "Escape") {
        closeLightbox();
      } else if (event.key === "ArrowLeft") {
        moveLightbox(-1);
      } else if (event.key === "ArrowRight") {
        moveLightbox(1);
      }
    });
  }

  setIndex(0);
})();

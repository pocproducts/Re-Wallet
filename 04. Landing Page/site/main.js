// Register GSAP ScrollTrigger
gsap.registerPlugin(ScrollTrigger);

document.addEventListener("DOMContentLoaded", () => {
  // --- 1. Automatic 3D Carousel Logic ---
  const cards = document.querySelectorAll(".carousel-card");
  let currentIndex = 0;
  const totalCards = cards.length;

  // Function to update positions of the cards to create a 3D depth effect
  function updateCarousel() {
    cards.forEach((card, index) => {
      // Calculate relative index based on current active card
      let relativeIndex = (index - currentIndex + totalCards) % totalCards;

      // Base state (invisible/far back)
      let xOffset = -100;
      let zOffset = -500;
      let scale = 0.8;
      let opacity = 0;
      let zIndex = 0;

      if (relativeIndex === 0) {
        // Front active card
        xOffset = 0;
        zOffset = 0;
        scale = 1;
        opacity = 1;
        zIndex = 10;
      } else if (relativeIndex === 1) {
        // Second card (behind and to the left)
        xOffset = -220;
        zOffset = -150;
        scale = 0.9;
        opacity = 0.7;
        zIndex = 5;
      } else if (relativeIndex === 2) {
        // Third card (furthest back and to the left)
        xOffset = -400;
        zOffset = -300;
        scale = 0.8;
        opacity = 0.3;
        zIndex = 1;
      }

      // Animate to new position using GSAP
      gsap.to(card, {
        x: xOffset,
        z: zOffset,
        scale: scale,
        opacity: opacity,
        zIndex: zIndex,
        duration: 0.8,
        ease: "power3.out"
      });
    });
  }

  // Initialize carousel positions
  updateCarousel();

  // Auto-play interval
  setInterval(() => {
    currentIndex = (currentIndex + 1) % totalCards;
    updateCarousel();
  }, 4000); // Rotates every 4 seconds

  // --- 2. Cinematic ScrollTrigger Animations ---

  // Parallax effect on the giant background text
  gsap.to("#parallax-text", {
    yPercent: 50,
    ease: "none",
    scrollTrigger: {
      trigger: ".hero",
      start: "top top",
      end: "bottom top",
      scrub: true
    }
  });

  // Reveal animation for Discover Header Text
  gsap.from(".gsap-reveal", {
    y: 40,
    opacity: 0,
    duration: 1,
    stagger: 0.2,
    ease: "power2.out",
    scrollTrigger: {
      trigger: ".discover",
      start: "top 80%"
    }
  });

  // Chunky Clay Card stagger reveal
  gsap.from(".gsap-card", {
    y: 80,
    opacity: 0,
    rotation: 2,
    duration: 1.2,
    stagger: 0.2,
    ease: "back.out(1.2)",
    scrollTrigger: {
      trigger: ".discover-grid",
      start: "top 85%"
    }
  });
});

/* ── Live Privy metrics ───────────────────────────────────────────────────
 * Reads the public aggregate endpoint on the backend (beta.rewallet.win).
 * On any failure the em-dashes stay: honest absence beats a made-up number.
 */
(function loadMetrics() {
  const API = "https://beta.rewallet.win/api/metrics/privy";
  const targets = {
    walletsCreated: document.getElementById("metric-wallets"),
    activeUsers24h: document.getElementById("metric-active"),
    signIns: document.getElementById("metric-signins"),
  };
  if (!targets.walletsCreated) return;

  fetch(API)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((metrics) => {
      for (const [key, el] of Object.entries(targets)) {
        const value = metrics[key];
        if (el && typeof value === "number") {
          el.textContent = value.toLocaleString("es-AR");
        }
      }
    })
    .catch(() => {
      /* leave the dashes */
    });
})();

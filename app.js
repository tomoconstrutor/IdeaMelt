(function () {
  const config = window.IDEA_MELT_CONFIG || {};
  const forms = document.querySelectorAll("[data-signup-form]");
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

  forms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitSignup(form);
    });
  });

  async function submitSignup(form) {
    const emailInput = form.querySelector('input[name="email"]');
    const honeypotInput = form.querySelector('input[name="website"]');
    const button = form.querySelector("button");

    if (!emailInput || !button) {
      return;
    }

    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      setMessage(form, "Hmm. That email looks off.", "error");
      emailInput.focus();
      return;
    }

    const endpoint = getSubscribeEndpoint();
    if (!endpoint) {
      setMessage(form, "Signup is not wired yet.", "error");
      return;
    }

    setFormState(form, true);
    setMessage(form, "Adding you...", "neutral");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          email,
          sourceForm: form.dataset.sourceForm || "unknown",
          website: honeypotInput ? honeypotInput.value : "",
          utm: readUtmParams(),
          referringSite: document.referrer || null,
        }),
      });

      const body = await safeJson(response);
      if (!response.ok || !body || body.ok !== true) {
        throw new Error(body && body.message ? body.message : "Signup failed. Try again in a moment.");
      }

      form.reset();
      setMessage(form, body.message || "Nice. You're on the list.", "success");
    } catch (error) {
      setMessage(form, error.message || "Something snapped. Try again in a minute.", "error");
    } finally {
      setFormState(form, false);
    }
  }

  function getSubscribeEndpoint() {
    const baseUrl = typeof config.functionsBaseUrl === "string"
      ? config.functionsBaseUrl.trim().replace(/\/+$/, "")
      : "";

    if (!baseUrl || baseUrl.includes("YOUR_")) {
      return "";
    }

    return `${baseUrl}/subscribe`;
  }

  function buildHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };

    if (typeof config.supabaseAnonKey === "string" && config.supabaseAnonKey.trim()) {
      headers.apikey = config.supabaseAnonKey.trim();
      headers.Authorization = `Bearer ${config.supabaseAnonKey.trim()}`;
    }

    return headers;
  }

  function readUtmParams() {
    const params = new URLSearchParams(window.location.search);
    return utmKeys.reduce((utm, key) => {
      const value = params.get(key);
      if (value) {
        utm[key] = value.slice(0, 200);
      }

      return utm;
    }, {});
  }

  function setFormState(form, isLoading) {
    const button = form.querySelector("button");
    form.dataset.state = isLoading ? "loading" : "idle";

    if (button) {
      button.disabled = isLoading;
    }
  }

  function setMessage(form, message, tone) {
    const messageElement = form.querySelector("[data-form-message]");
    if (!messageElement) {
      return;
    }

    messageElement.textContent = message;
    messageElement.dataset.tone = tone;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
})();

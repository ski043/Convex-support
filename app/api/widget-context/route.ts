const countryPattern = /^[A-Z]{2}$/;
const timezonePattern = /^[A-Za-z0-9_+\-/]{1,64}$/;

function cleanCity(value: string | null) {
  if (!value) return null;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Some platforms send an already decoded value.
  }

  const city = decoded.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return city ? city.slice(0, 100) : null;
}

function cleanCountry(value: string | null) {
  const country = value?.trim().toUpperCase() ?? "";
  if (!countryPattern.test(country) || country === "XX") return null;
  return country;
}

function cleanTimezone(value: string | null) {
  const timezone = value?.trim() ?? "";
  if (!timezonePattern.test(timezone)) return null;

  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  return Response.json(
    {
      city: cleanCity(request.headers.get("x-vercel-ip-city")),
      country: cleanCountry(request.headers.get("x-vercel-ip-country")),
      timezone: cleanTimezone(request.headers.get("x-vercel-ip-timezone")),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

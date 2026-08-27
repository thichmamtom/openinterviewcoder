/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./settings.html", "./src/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

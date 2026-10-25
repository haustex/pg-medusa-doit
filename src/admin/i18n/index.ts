import en from "./json/en.json" with { type: "json" }
import id from "./json/id.json" with { type: "json" }

// Keys live under "doit"; the Admin picks the language the user selected (id / en, others fall back to en).
export default {
  en: { translation: en },
  id: { translation: id },
}

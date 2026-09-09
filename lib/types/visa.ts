export type VisaRequirement = {
  docType:     string   // machine-readable key, must match Document.docType
  label:       string   // display name, e.g. "Paspor Asli (scan semua halaman)"
  description: string   // detail instruction for the pilgrim
  required:    boolean  // true = mandatory; false = optional/conditional
}

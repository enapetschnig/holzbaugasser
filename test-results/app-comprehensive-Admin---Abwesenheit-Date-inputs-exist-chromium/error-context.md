# Page snapshot

```yaml
- generic [ref=e2]:
  - region "Notifications (F8)":
    - list
  - region "Notifications alt+T"
  - generic [ref=e4]:
    - generic [ref=e5]:
      - img "Holzbau Gasser" [ref=e6]
      - heading "Holzbau Gasser" [level=3] [ref=e7]
      - paragraph [ref=e8]: Projektdokumentation
    - generic [ref=e10]:
      - generic [ref=e11]:
        - button "Anmelden" [ref=e12] [cursor=pointer]
        - button "Registrieren" [ref=e13] [cursor=pointer]
      - generic [ref=e14]:
        - generic [ref=e15]:
          - text: E-Mail
          - textbox "E-Mail" [ref=e16]:
            - /placeholder: ihre@email.at
            - text: napetschnig.chris@gmail.com
        - generic [ref=e17]:
          - text: Passwort
          - textbox "Passwort" [ref=e18]: nereirtsiger
        - button "Passwort vergessen?" [ref=e19] [cursor=pointer]
        - button "Lädt..." [disabled]
```
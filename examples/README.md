### Example

See `examples/simple.flow` and `examples/complex.flow`. A minimal example:

```text
diagram {
  title = "Newsletter Signup"

  boundary web {
    title = "Public Website"
    io visitor { title = "Visitor" }
    function frontend { title = "Web Frontend" }
  }

  database mailing_list { title = "Mailing List DB" }

  visitor -> frontend {
    operation = "Submit form"
    data = ["Email address"]
  }

  frontend -> mailing_list {
    operation = "Store contact"
    data = ["Email address", "Timestamp"]
  }
}
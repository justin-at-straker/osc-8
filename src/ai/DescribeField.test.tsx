import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, it } from "vitest"
import { getUiAgent } from "./ui-agent"
import { DescribeField } from "./DescribeField"

it("without a key, Generate shows an inline error and opens KeySettings; the widget is hidden from the agent", async () => {
  render(<DescribeField />)
  const input = screen.getByLabelText("Describe a sound or a groove")
  fireEvent.input(input, { target: { value: "warm pad" } })
  fireEvent.click(screen.getByRole("button", { name: "Generate" }))

  await waitFor(() => expect(screen.getByText("NO API KEY: ADD ONE TO START")).toBeTruthy())
  await waitFor(() => expect(screen.getByText("OpenAI key")).toBeTruthy())
  expect(screen.getByText(/stays in this browser and is sent only to OpenAI/)).toBeTruthy()

  const labels = getUiAgent().snapshot().map((c) => c.label)
  expect(labels).not.toContain("Describe a sound or a groove")
  expect(labels).not.toContain("OpenAI API key")
})

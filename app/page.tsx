import { createClient } from "@/utils/supabase/server";

type Todo = {
  id: string | number;
  name: string;
};

export default async function Page() {
  const supabase = await createClient();
  const { data: todos, error } = await supabase.from("todos").select();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-3xl font-semibold">AI-Powered ORM MVP</h1>
      <p className="mb-6 text-sm text-slate-600">
        Day 1 setup complete: Next.js + Tailwind + Supabase SSR.
      </p>

      {error ? (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          Could not load `todos`: {error.message}
        </p>
      ) : (
        <ul className="space-y-2">
          {(todos as Todo[] | null)?.map((todo) => (
            <li key={todo.id} className="rounded-md border border-slate-200 p-3">
              {todo.name}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

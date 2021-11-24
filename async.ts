import { MuxAsyncIterator } from 'https://deno.land/std/async/mux_async_iterator.ts';

/** */
export async function* kunokazu<S, T>(
	limit: number,
	values: Iterable<S> | AsyncIterable<S>,
	iteratorFn: (value: S) => AsyncIterable<T>
) {
	limit = limit < 1 ? 1 : limit;

	async function* iterateIterators() {
		for await (const value of values) {
			const iter = iteratorFn(value);
			if (!iter) throw new Error();
			yield iter;
		}
	}

	const errors: unknown[] = [];
	const iterators = iterateIterators();

	async function* okazu(id: number) {
		for await (const iter of iterators) {
			if (errors.length) {
				throw new Error(`${id} stopped`);
			}
			try {
				yield* iter;
			} catch (err) {
				errors.push(err);
				break;
			}
		}
	}

	const mux = new MuxAsyncIterator<T>();
	for (let i = 0; i < limit; i++) mux.add(okazu(i));
	yield* mux;

	if (errors.length > 0) {
		throw new AggregateError(errors);
	}
}

// async function* countdown() {
// 	for (let i = 10; i > 0; i--) {
// 		try {
// 			console.log('countdown', 'call', i);
// 			await new Promise((r) => setTimeout(r, 100));
// 			console.log('countdown', 'yield', i);
// 			yield i;
// 		} catch (err) {
// 			console.log('countdown', 'catch', err.message);
// 			throw err;
// 		}
// 	}
// }

// async function* abcs(i: number) {
// 	yield `abcs() before ${i}`;
// 	await new Promise((r) => setTimeout(r, 2000));
// 	yield `abcs() middle ${i}`;
// 	throw new Error('sdfsfsdf');
// 	await new Promise((r) => setTimeout(r, 2000));
// 	yield `abcs() after ${i}`;
// }

// async function* composed() {
// 	for await (const i of countdown()) {
// 		yield abcs(i);
// 	}
// }

// async function test() {
// 	console.log('test', 'call');
// 	for await (const abc of kunokazu(1, composed())) {
// 		console.log('test', 'loop', abc);
// 		// if (i === 9) await Promise.reject(new Error('7 8 9'));
// 		// if (i === 8) return Promise.resolve(8);
// 	}
// }

// console.log('done', await test());

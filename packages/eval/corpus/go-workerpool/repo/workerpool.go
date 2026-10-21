package workerpool

import "context"

func Run(
	ctx context.Context,
	jobs []int,
	workers int,
	fn func(context.Context, int) (int, error),
) ([]int, error) {
	results := make([]int, 0, len(jobs))
	for _, job := range jobs {
		value, err := fn(ctx, job)
		if err != nil {
			return nil, err
		}
		results = append(results, value)
	}
	return results, nil
}

export const ErrorHandler = (err, req, res) => {
	console.log('Custom error middleware');
	const errStatus = err.statusCode || 500;
	const errMsg = err.message || 'Something went wrong';
	res.status(errStatus).json({
		success: false,
		status: errStatus,
		message: errMsg,
		stack: err.stack
	});
};

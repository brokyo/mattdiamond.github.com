var fileReader = new FileReader(),
	context = new AudioContext(),
	sampleRate = context.sampleRate;

fileReader.onload = function(){
	console.log('decoding...');
	context.decodeAudioData(fileReader.result, function(buffer){
		processBuffer(buffer);
	});
};

window.onload = function(){
	bindFileInput();

	fetch('/samples/sufjan.wav').then(function(response){
		return response.arrayBuffer();
	}).then(function(arrayBuffer){
		return context.decodeAudioData(arrayBuffer);
	}).then(processBuffer);
};

function bindFileInput(){
	var fileInput = document.getElementById('FileInput');
	fileInput.onchange = function(){
		var file = this.files[0];
		fileReader.readAsArrayBuffer(file);
	};
}

function processBuffer(buffer){
	console.log('running fft...');
	var processedL = fft.frequencyMap(buffer.getChannelData(0), mapFunc);
	var processedR = fft.frequencyMap(buffer.getChannelData(1), mapFunc);

	buffer.copyToChannel(processedL.real, 0);
	buffer.copyToChannel(processedR.real, 1);

	var source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(context.destination);
	console.log('starting buffer...');
	source.start();
}

function mapFunc(obj, i, n){
	obj.real /= 2;
}
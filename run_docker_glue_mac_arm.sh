docker run --rm -it \
  --platform linux/amd64 \
  --name gluetools \
  --network gluetools-network \
  --mount type=bind,source="$PWD",target=/workspace/ERVdb-HomoSapiens \
  --workdir /workspace/ERVdb-HomoSapiens \
  cvrbioinformatics/gluetools:latest